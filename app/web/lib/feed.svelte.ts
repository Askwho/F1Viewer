import { merge } from "../../shared/merge.ts";
import { Incidents, contextFrom, ingest } from "../../shared/incidents.ts";

// Connection to the relay plus the broadcast-delay buffer. The relay sends
// everything as soon as it has it; we hold each update until
// (server time - delay) passes its timestamp, so the dashboard can sit
// exactly level with the TV picture instead of spoiling it.

interface Entry {
  t: number;
  seq: number;
  topic: string;
  data: unknown;
  replace?: boolean;
}

export interface RelayStatus {
  source: string;
  detail: string;
  connected: boolean;
}

export interface Sample {
  ts: number;
  x: number;
  y: number;
  off: boolean;
}

const DELAY_KEY = "pitwall.delayMs";
const MAX_SAMPLES = 40; // ~10 s of position history per car
const CONTEXT_TOPICS = new Set(["SessionInfo", "SessionStatus", "TrackStatus", "TimingData", "LapCount"]);

function loadDelay(): number {
  try {
    return Number(localStorage.getItem(DELAY_KEY)) || 0;
  } catch {
    return 0;
  }
}

class Feed {
  /** Merged session state at the delayed playhead. Not deeply reactive: read it after `version` changes. */
  raw: Record<string, any> = {};
  version = $state(0);
  delayMs = $state(loadDelay());
  socketOpen = $state(false);
  relay = $state<RelayStatus>({ source: "", detail: "", connected: false });
  /** Server time of the newest undelayed LapCount change (for sync-to-TV). */
  lastLapTickT = 0;
  /** Per-car position samples, F1 timestamps in ms. */
  samples = new Map<string, Sample[]>();
  private lagHistory: number[] = [];
  /** Cars in trouble, detected from telemetry at the delayed playhead. */
  incidents = new Incidents();
  /** Estimated distance (ms) between the playhead and the newest position sample. */
  positionLag = 1500;

  private ws?: WebSocket;
  private queue: Entry[] = [];
  private serverOffset = 0;
  private retry = 500;

  start() {
    this.connect();
    setInterval(() => this.tick(), 100);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !this.socketOpen) this.connect();
    });
  }

  /** Server clock now, in ms. */
  serverNow() {
    return Date.now() + this.serverOffset;
  }

  /** The moment the dashboard is currently showing, on the server clock. */
  playhead() {
    return this.serverNow() - this.delayMs;
  }

  /** Session UTC for the playhead (differs from wall time when replaying). */
  sessionNow() {
    const c = this.raw.__clock;
    const t = this.playhead();
    return c ? c.utc + (t - c.base) * (c.speed || 1) : t;
  }

  setDelay(ms: number) {
    this.delayMs = Math.max(0, Math.min(600_000, Math.round(ms)));
    try {
      localStorage.setItem(DELAY_KEY, String(this.delayMs));
    } catch {}
    this.resync();
  }

  /** Delay so that the last lap tick lines up with "now" on TV. */
  syncToLeaderCrossing() {
    if (!this.lastLapTickT) return false;
    this.setDelay(this.serverNow() - this.lastLapTickT);
    return true;
  }

  private resyncTimer?: ReturnType<typeof setTimeout>;
  private resync() {
    clearTimeout(this.resyncTimer);
    this.resyncTimer = setTimeout(() => this.hello(), 300);
  }

  private hello() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "hello", delayMs: this.delayMs }));
  }

  private connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.socketOpen = true;
      this.retry = 500;
      this.hello();
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.socketOpen = false;
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 8000);
    };
    ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
  }

  private onMessage(m: any) {
    if (m.type === "snapshot") {
      this.serverOffset = m.serverNow - Date.now();
      this.raw = m.state;
      this.samples.clear();
      this.lagHistory = [];
      this.queue = m.backlog;
      this.relay = m.status;
      for (const e of this.queue) this.noteUndelayed(e);
      if (this.raw.Position) this.addSamples(this.raw.Position, m.t);
      this.incidents.resetCars();
      this.incidents.setContext(contextFrom(this.raw));
      ingest(this.incidents, "CarData", this.raw.CarData);
      ingest(this.incidents, "Position", this.raw.Position);
      this.version++;
    } else if (m.type === "msg") {
      this.queue.push(m);
      this.noteUndelayed(m);
    } else if (m.type === "status") {
      this.relay = m.status;
    }
  }

  private noteUndelayed(e: Entry) {
    if (e.topic === "LapCount" && (e.data as any)?.CurrentLap !== undefined) this.lastLapTickT = e.t;
  }

  private tick() {
    const due = this.playhead();
    let n = 0;
    while (n < this.queue.length && this.queue[n].t <= due) n++;
    if (!n) return;
    for (const e of this.queue.splice(0, n)) this.apply(e);
    this.version++;
  }

  private apply(e: Entry) {
    if (e.topic === "__reset") {
      this.raw = {};
      this.samples.clear();
      this.incidents.reset();
      return;
    }
    this.raw[e.topic] = e.replace ? merge(undefined, e.data) : merge(this.raw[e.topic], e.data);
    if (e.topic === "Position") this.addSamples(e.data, e.t);
    if (e.topic === "CarData" || e.topic === "Position") ingest(this.incidents, e.topic, e.data);
    else if (CONTEXT_TOPICS.has(e.topic)) this.incidents.setContext(contextFrom(this.raw));
  }

  private addSamples(pos: any, t: number) {
    const batches = pos?.Position;
    if (!Array.isArray(batches)) return;
    let newest = 0;
    for (const b of batches) {
      const ts = Date.parse(b.Timestamp);
      if (!ts) continue;
      newest = Math.max(newest, ts);
      for (const num in b.Entries) {
        const p = b.Entries[num];
        let arr = this.samples.get(num);
        if (!arr) this.samples.set(num, (arr = []));
        if (arr.length && arr[arr.length - 1].ts >= ts) continue;
        arr.push({ ts, x: p.X, y: p.Y, off: p.Status === "OffTrack" });
        if (arr.length > MAX_SAMPLES) arr.shift();
      }
    }
    if (!newest) return;
    // How far the newest sample trails the session clock when its batch lands.
    const c = this.raw.__clock;
    const sessionAtT = c ? c.utc + (t - c.base) * (c.speed || 1) : t;
    this.lagHistory.push(sessionAtT - newest);
    if (this.lagHistory.length > 15) this.lagHistory.shift();
    const sorted = [...this.lagHistory].sort((a, b) => a - b);
    // Stay one batch behind the newest sample so there's always something to interpolate towards.
    this.positionLag = sorted[Math.floor(sorted.length * 0.75)] + 1100;
  }
}

export const feed = new Feed();
