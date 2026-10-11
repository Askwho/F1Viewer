import type { Hub } from "../hub.ts";
import type { TokenStore } from "../token.ts";

// Client for F1's SignalR Core live timing endpoint. Speaks the JSON hub
// protocol directly over a WebSocket: negotiate → connect → handshake →
// Subscribe(topics). The Subscribe result is the full current state of every
// topic; afterwards "feed" invocations carry deltas.

const BASE = "https://livetiming.formula1.com/signalrcore";
const RS = "\u001e";
const UA = "BestHTTP";

export const TOPICS = [
  "Heartbeat", "SessionInfo", "SessionStatus", "SessionData", "ArchiveStatus",
  "TrackStatus", "LapCount", "ExtrapolatedClock", "WeatherData",
  "DriverList", "TimingData", "TimingAppData", "TimingStats", "TopThree",
  "RaceControlMessages", "TeamRadio", "TyreStintSeries", "CurrentTyres",
  "LapSeries", "DriverRaceInfo", "PitStopSeries", "PitLaneTimeCollection",
  "PitStop", "ChampionshipPrediction", "OvertakeSeries",
  // Need an F1 TV subscription token:
  "Position.z", "CarData.z",
];

export class LiveSource {
  private ws?: WebSocket;
  private pingTimer?: NodeJS.Timeout;
  private watchdog?: NodeJS.Timeout;
  private sessionPoll?: NodeJS.Timeout;
  private backoff = 2000;
  private stopped = false;
  private sessionKey?: number;
  private lastMsgAt = 0;

  private hub: Hub;
  private tokens: TokenStore;

  constructor(hub: Hub, tokens: TokenStore) {
    this.hub = hub;
    this.tokens = tokens;
  }

  start() {
    this.stopped = false;
    this.connect();
    // Notice a new session (e.g. FP3 → Qualifying) even if the socket stays up.
    this.sessionPoll = setInterval(() => this.checkSession(), 60_000);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.sessionPoll);
    this.teardown();
  }

  /** Reconnect now, e.g. after the token changes. */
  restart() {
    this.teardown();
    this.backoff = 2000;
    this.connect();
  }

  private teardown() {
    clearInterval(this.pingTimer);
    clearInterval(this.watchdog);
    const ws = this.ws;
    this.ws = undefined;
    try {
      ws?.close();
    } catch {}
  }

  private scheduleReconnect(reason: string) {
    if (this.stopped) return;
    this.teardown();
    this.hub.setStatus("live", `reconnecting: ${reason}`, false);
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 60_000);
    setTimeout(() => !this.stopped && !this.ws && this.connect(), wait);
  }

  private async connect() {
    const token = this.tokens.token();
    const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const opt = await fetch(`${BASE}/negotiate?negotiateVersion=1`, { method: "OPTIONS", headers: { "User-Agent": UA } });
      const cookie = (opt.headers.get("set-cookie") || "").split(";")[0];
      const res = await fetch(`${BASE}/negotiate?negotiateVersion=1`, {
        method: "POST",
        headers: { cookie, "User-Agent": UA, ...auth },
      });
      if (!res.ok) throw new Error(`negotiate HTTP ${res.status}`);
      const neg = await res.json();
      // ASP.NET SignalR accepts the token as a header or, for WebSockets, as a query parameter; send both.
      const tokenQuery = token ? `&access_token=${encodeURIComponent(token)}` : "";
      const url = `${BASE.replace("https", "wss")}?id=${encodeURIComponent(neg.connectionToken)}${tokenQuery}`;
      // Node's WebSocket (undici) accepts headers as a non-standard option.
      const ws = new WebSocket(url, { headers: { cookie, "User-Agent": UA, ...auth } } as any);
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ protocol: "json", version: 1 }) + RS);
      ws.onmessage = (ev) => this.onFrame(String(ev.data));
      ws.onerror = () => {};
      ws.onclose = (ev) => this.ws === ws && this.scheduleReconnect(`closed ${ev.code}`);
    } catch (err: any) {
      this.scheduleReconnect(err?.message || String(err));
    }
  }

  private onFrame(frame: string) {
    this.lastMsgAt = Date.now();
    for (const part of frame.split(RS)) {
      if (!part) continue;
      let m: any;
      try {
        m = JSON.parse(part);
      } catch {
        continue;
      }
      if (m.type === undefined) {
        if (m.error) return this.scheduleReconnect(`handshake: ${m.error}`);
        this.ws!.send(JSON.stringify({ type: 1, invocationId: "sub", target: "Subscribe", arguments: [TOPICS] }) + RS);
        this.pingTimer = setInterval(() => this.ws?.send(JSON.stringify({ type: 6 }) + RS), 15_000);
        this.watchdog = setInterval(() => {
          if (Date.now() - this.lastMsgAt > 45_000) this.scheduleReconnect("no data for 45s");
        }, 10_000);
      } else if (m.type === 3 && m.invocationId === "sub") {
        if (m.error) return this.scheduleReconnect(`subscribe: ${m.error}`);
        this.onInitial(m.result || {});
      } else if (m.type === 1 && m.target === "feed") {
        const [topic, data] = m.arguments;
        this.hub.ingest(topic, data);
      } else if (m.type === 7) {
        this.scheduleReconnect(`server closed: ${m.error || "no reason"}`);
      }
    }
  }

  private onInitial(result: Record<string, unknown>) {
    this.backoff = 2000;
    const key = (result.SessionInfo as any)?.Key;
    if (key !== this.sessionKey) {
      this.hub.reset();
      this.sessionKey = key;
    }
    for (const [topic, data] of Object.entries(result)) {
      if (data !== null && data !== undefined) this.hub.ingest(topic, data, Date.now(), true);
    }
    const gated = ["Position.z", "CarData.z"].filter((t) => !(t in result) || !result[t]);
    const hasToken = !!this.tokens.token();
    const note = gated.length
      ? hasToken
        ? "token set but positions/telemetry not granted (expired or no subscription?)"
        : "no F1 TV token: no car positions/telemetry"
      : "positions + telemetry";
    this.hub.setStatus("live", note, true);
    console.log(`[live] subscribed: ${Object.keys(result).length} topics; ${note}`);
  }

  private async checkSession() {
    try {
      const res = await fetch("https://livetiming.formula1.com/static/SessionInfo.json", { headers: { "User-Agent": UA } });
      const info = JSON.parse((await res.text()).replace(/^﻿/, ""));
      if (this.sessionKey !== undefined && info.Key !== this.sessionKey) {
        console.log(`[live] session changed ${this.sessionKey} → ${info.Key} (${info.Name}); resubscribing`);
        this.restart();
      }
    } catch {}
  }
}
