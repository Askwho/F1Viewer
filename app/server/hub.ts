import { inflateRawSync } from "node:zlib";
import type { WebSocket } from "ws";
import { merge } from "../shared/merge.ts";
import { LapRecorder } from "./laps.ts";
import { Tracer, type Outline } from "./trace.ts";
import { Incidents, contextFrom, ingest as feedIncidents } from "../shared/incidents.ts";

// The hub owns the canonical session state and a time-stamped history of
// every update. Clients ask for "the state as of now - delay" and then
// receive every later update, applying each when its delay elapses.

export interface Entry {
  t: number; // server ms when received
  seq: number;
  topic: string;
  data: unknown;
  replace?: boolean;
}

const SNAPSHOT_EVERY_MS = 10_000;
const RETAIN_MS = 12 * 60_000; // supports delays up to ~10 min

// High-rate topics replace rather than merge; clients interpolate the samples.
const REPLACE_TOPICS = new Set(["Position", "CarData"]);

export function decodeZ(data: unknown): unknown {
  if (typeof data !== "string") return data;
  return JSON.parse(inflateRawSync(Buffer.from(data, "base64")).toString("utf8"));
}

export class Hub {
  state: Record<string, any> = {};
  private log: Entry[] = [];
  private snapshots: { t: number; seq: number; state: Record<string, any> }[] = [];
  private seq = 0;
  private clients = new Set<WebSocket>();
  private laps = new LapRecorder();
  private tracer = new Tracer();
  private incidents = new Incidents();
  onTrace?: (outline: Outline, circuitKey: number) => void;
  onEntry?: (e: Entry) => void;
  status = { source: "idle", detail: "", connected: false, since: Date.now() };

  constructor() {
    this.snapshots.push({ t: Date.now(), seq: 0, state: {} });
    setInterval(() => this.snapshotNow(), SNAPSHOT_EVERY_MS).unref();
  }

  /** Accepts raw feed topics; `.z` topics are inflated and renamed. */
  ingest(topic: string, data: unknown, t = Date.now(), replace = false) {
    if (topic.endsWith(".z")) {
      topic = topic.slice(0, -2);
      try {
        data = decodeZ(data);
      } catch {
        return;
      }
    }
    const isReplace = replace || REPLACE_TOPICS.has(topic);
    this.state[topic] = isReplace ? merge(undefined, data) : merge(this.state[topic], data);
    this.push({ t, topic, data, replace: isReplace || undefined } as Entry);

    if (topic === "Position" && !this.tracer.result) {
      const lines = this.state.TimingData?.Lines || {};
      const outline = this.tracer.observe(data, (n) => !lines[n]?.InPit && !lines[n]?.PitOut);
      const key = this.state.SessionInfo?.Meeting?.Circuit?.Key;
      if (outline && key) this.onTrace?.(outline, key);
    }

    // Cars in trouble, spotted from telemetry. The relay keeps the log so every
    // screen agrees on when it happened, even one opened later.
    if (topic === "CarData" || topic === "Position") {
      feedIncidents(this.incidents, topic, data);
      const before = this.incidents.events.length;
      if (topic === "CarData") this.incidents.evaluate();
      const fresh = this.incidents.events.slice(before);
      if (fresh.length) {
        const delta = { Events: Object.fromEntries(fresh.map((e, i) => [before + i, e])) };
        this.state.Incidents = merge(this.state.Incidents, delta);
        this.push({ t, topic: "Incidents", data: delta } as Entry);
      }
    } else if (["SessionInfo", "SessionStatus", "TrackStatus", "TimingData", "LapCount"].includes(topic)) {
      this.incidents.setContext(contextFrom(this.state));
    }

    if (topic === "TimingData" || topic === "TimingAppData") {
      const lapDelta = this.laps.observe(this.state, t);
      if (lapDelta) {
        this.state.LapHistory = merge(this.state.LapHistory, lapDelta);
        this.push({ t, topic: "LapHistory", data: lapDelta } as Entry);
      }
    }
  }

  /** New session: everyone (at their own delay) resets to empty. */
  reset(t = Date.now()) {
    this.state = {};
    this.laps = new LapRecorder();
    this.tracer = new Tracer();
    this.incidents = new Incidents();
    this.push({ t, topic: "__reset", data: null } as Entry);
  }

  setStatus(source: string, detail: string, connected: boolean) {
    this.status = { source, detail, connected, since: Date.now() };
    this.broadcast(JSON.stringify({ type: "status", status: this.status }));
  }

  private push(e: Entry) {
    e.seq = ++this.seq;
    this.log.push(e);
    this.onEntry?.(e);
    this.broadcast(JSON.stringify({ type: "msg", ...e }));
  }

  snapshotNow() {
    const now = Date.now();
    this.snapshots.push({ t: now, seq: this.seq, state: structuredClone(this.state) });
    const keepFrom = now - RETAIN_MS;
    // Keep the newest snapshot older than the retention window as the floor.
    while (this.snapshots.length > 1 && this.snapshots[1].t <= keepFrom) this.snapshots.shift();
    const floor = this.snapshots[0].seq;
    let i = 0;
    while (i < this.log.length && this.log[i].seq <= floor) i++;
    if (i) this.log.splice(0, i);
  }

  private broadcast(payload: string) {
    for (const ws of this.clients) if (ws.readyState === 1) ws.send(payload);
  }

  attach(ws: WebSocket) {
    ws.on("message", (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "hello") this.sync(ws, Number(msg.delayMs) || 0);
    });
    ws.on("close", () => this.clients.delete(ws));
  }

  /** Send the snapshot at or before now - delay, then the backlog, then go live. */
  private sync(ws: WebSocket, delayMs: number) {
    this.clients.delete(ws);
    const target = Date.now() - delayMs;
    let snap = this.snapshots[0];
    for (const s of this.snapshots) if (s.t <= target) snap = s;
    const backlog = this.log.filter((e) => e.seq > snap.seq);
    ws.send(
      JSON.stringify({
        type: "snapshot",
        serverNow: Date.now(),
        t: snap.t,
        state: snap.state,
        backlog,
        status: this.status,
      }),
    );
    this.clients.add(ws);
  }
}
