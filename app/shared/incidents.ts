// Spots cars in trouble from telemetry, before (or without) race control saying so.
//
// The field teaches us what "normal" looks like: every sample from a healthy
// car feeds a running average speed for the patch of track it's on. A car far
// below that average for its patch, or sitting still, is an incident. A car
// parked on track with its engine off is out of the race, even though F1's
// timing often keeps listing it for laps.

export type IncidentKind = "slow" | "stopped" | "out";

export interface Incident {
  kind: IncidentKind;
  /** F1 time (ms) the current kind began. */
  since: number;
  /** F1 time (ms) the car was last seen in trouble; held briefly after recovery. */
  last: number;
}

export interface IncidentEvent {
  utc: number;
  num: string;
  kind: IncidentKind;
  lap?: number;
}

interface Car {
  speed: { ts: number; v: number; rpm: number }[];
  x: number;
  y: number;
  posTs: number;
  stillSince: number; // speed < STOP_KMH (and engine off for `dead`) continuously since
  deadSince: number;
}

/** What the evaluator needs to know about the session, read from the merged feed state. */
export interface Context {
  running: boolean; // a race or sprint is under way (in practice and qualifying, slow laps are routine)
  neutralised: boolean; // SC / VSC: everyone is slow, so only stopped cars count
  red: boolean;
  inPit: Set<string>;
  lap?: number;
}

const CELL = 150; // track patch size, decimetres (15 m)
const WINDOW = 3000; // a car must be in trouble for this long (ms)
const HOLD = 10_000; // keep showing a recovered car this long (ms)
const SLOW_RATIO = 0.45;
const MIN_REF = 90; // ignore patches where normal speed is already this low (km/h)
const MIN_REF_SAMPLES = 12;
const STOP_KMH = 5;
const OUT_AFTER = 15_000; // engine off and stationary this long → out of the race
const OUT_AFTER_IDLE = 45_000; // or stationary with the engine running this long
const START_GRACE = 20_000; // cars sit on the grid, and a stalled launch is not an incident yet

export class Incidents {
  private cars = new Map<string, Car>();
  private ref = new Map<string, { v: number; n: number }>();
  private state = new Map<string, Incident>();
  private ctx: Context = { running: false, neutralised: false, red: false, inPit: new Set() };
  events: IncidentEvent[] = [];
  now = 0;
  private runningSince = 0;
  private quietUntil = 0;

  reset() {
    this.cars.clear();
    this.ref.clear();
    this.state.clear();
    this.events = [];
    this.now = 0;
    this.runningSince = 0;
    this.quietUntil = 0;
  }

  /** Forget per-car history (e.g. after reconnecting) but keep what we've learnt about the track. */
  resetCars() {
    this.cars.clear();
  }

  setContext(ctx: Context) {
    // Joining a race already under way (no telemetry seen yet): no start grace needed.
    if (ctx.running && !this.ctx.running) {
      this.runningSince = this.now || -Infinity;
      // Cars already in trouble when we join get shown, but not logged with a wrong time.
      if (!this.now) this.quietUntil = -1;
    }
    this.ctx = ctx;
  }

  private car(num: string): Car {
    let c = this.cars.get(num);
    if (!c) this.cars.set(num, (c = { speed: [], x: 0, y: 0, posTs: 0, stillSince: 0, deadSince: 0 }));
    return c;
  }

  addPosition(num: string, ts: number, x: number, y: number) {
    if (x === 0 && y === 0) return;
    const c = this.car(num);
    if (ts < c.posTs) return;
    c.x = x;
    c.y = y;
    c.posTs = ts;
  }

  addSpeed(num: string, ts: number, v: number, rpm: number) {
    const c = this.car(num);
    const arr = c.speed;
    if (arr.length && arr[arr.length - 1].ts >= ts) return;
    arr.push({ ts, v, rpm });
    while (arr.length && arr[0].ts < ts - WINDOW - 1000) arr.shift();
    if (ts > this.now) this.now = ts;
    if (this.quietUntil === -1) this.quietUntil = ts + 30_000;

    if (v < STOP_KMH) {
      if (!c.stillSince) c.stillSince = ts;
      if (rpm < 500) {
        if (!c.deadSince) c.deadSince = ts;
      } else c.deadSince = 0;
    } else {
      c.stillSince = 0;
      c.deadSince = 0;
    }

    // Learn normal speed for this patch from healthy cars in green running.
    const { running, neutralised, red, inPit } = this.ctx;
    if (!running || neutralised || red || inPit.has(num) || this.state.has(num) || !c.posTs) return;
    if (Math.abs(ts - c.posTs) > 1500 || v < STOP_KMH) return;
    const key = this.cell(c.x, c.y);
    const r = this.ref.get(key);
    if (!r) this.ref.set(key, { v, n: 1 });
    else {
      r.n++;
      r.v += (v - r.v) * Math.max(0.08, 1 / r.n);
    }
  }

  private cell(x: number, y: number) {
    return `${Math.round(x / CELL)},${Math.round(y / CELL)}`;
  }

  /** Normal speed around (x, y), from this patch and its neighbours. */
  private normal(x: number, y: number): number | null {
    const cx = Math.round(x / CELL);
    const cy = Math.round(y / CELL);
    let sum = 0;
    let w = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const r = this.ref.get(`${cx + dx},${cy + dy}`);
        if (!r || r.n < MIN_REF_SAMPLES) continue;
        const k = dx || dy ? 1 : 3;
        sum += r.v * k;
        w += k;
      }
    return w ? sum / w : null;
  }

  /** Current incidents at the newest telemetry time. */
  evaluate(): Map<string, Incident> {
    const { running, neutralised, red, inPit } = this.ctx;
    const now = this.now;
    // Stillness only counts from the start (cars wait on the grid), with grace for the launch.
    const from = this.runningSince + START_GRACE;
    for (const [num, c] of this.cars) {
      const still = c.stillSince && Math.max(c.stillSince, from);
      const deadAt = c.deadSince && Math.max(c.deadSince, from);
      let kind: IncidentKind | null = null;
      const fresh = c.speed.length && now - c.speed[c.speed.length - 1].ts < 5000;
      if (running && now >= from && !red && !inPit.has(num) && fresh) {
        const dead = deadAt && now - deadAt >= OUT_AFTER;
        const idle = still && now - still >= OUT_AFTER_IDLE;
        if (dead || idle) kind = "out";
        else if (still && now - still >= WINDOW) kind = "stopped";
        else if (!neutralised) {
          const recent = c.speed.filter((s) => s.ts >= now - WINDOW);
          const spanned = recent.length >= 4 && recent[recent.length - 1].ts - recent[0].ts >= WINDOW * 0.75;
          const ref = c.posTs ? this.normal(c.x, c.y) : null;
          if (spanned && ref !== null && ref >= MIN_REF && recent.every((s) => s.v < ref * SLOW_RATIO)) kind = "slow";
        }
      }
      // An out car stays out until it moves again.
      const prev = this.state.get(num);
      if (prev?.kind === "out" && !kind && c.stillSince) kind = "out";

      if (kind) {
        if (!prev || prev.kind !== kind) {
          const rank = { slow: 0, stopped: 1, out: 2 };
          // Don't step down (out → stopped) while the car is still in trouble.
          if (prev && now - prev.last < HOLD && rank[prev.kind] > rank[kind]) {
            prev.last = now;
            continue;
          }
          this.state.set(num, { kind, since: now, last: now });
          if (now >= this.quietUntil) this.events.push({ utc: now, num, kind, lap: this.ctx.lap });
        } else prev.last = now;
      } else if (prev && (now - prev.last >= HOLD || !running || red)) this.state.delete(num);
    }
    return new Map(this.state);
  }
}

/** Session facts the detector needs, from the merged feed state. */
export function contextFrom(raw: any): Context {
  const status = raw.SessionStatus?.Status;
  const track = String(raw.TrackStatus?.Status ?? "1");
  const inPit = new Set<string>();
  const lines = raw.TimingData?.Lines || {};
  for (const num in lines) if (lines[num]?.InPit || lines[num]?.PitOut) inPit.add(num);
  return {
    running: status === "Started" && raw.SessionInfo?.Type === "Race",
    neutralised: track === "4" || track === "6" || track === "7",
    red: track === "5",
    inPit,
    lap: raw.LapCount?.CurrentLap,
  };
}

/** Feed CarData / Position payloads (as merged or as deltas) into the detector. */
export function ingest(inc: Incidents, topic: string, data: any) {
  if (topic === "CarData") {
    for (const e of data?.Entries || []) {
      const ts = Date.parse(e.Utc);
      if (!ts) continue;
      for (const num in e.Cars || {}) {
        const ch = e.Cars[num]?.Channels;
        if (ch) inc.addSpeed(num, ts, Number(ch["2"]) || 0, Number(ch["0"]) || 0);
      }
    }
  } else if (topic === "Position") {
    for (const b of data?.Position || []) {
      const ts = Date.parse(b.Timestamp);
      if (!ts) continue;
      for (const num in b.Entries || {}) {
        const p = b.Entries[num];
        inc.addPosition(num, ts, p.X, p.Y);
      }
    }
  }
}
