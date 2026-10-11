// Turns raw feed state into exactly what the screen needs. Everything here
// is a pure function of the state so it can be recomputed on every tick.

import type { IncidentEvent } from "../../shared/incidents.ts";

export type Mark = "" | "pb" | "ob"; // personal best (green) / overall best (purple)
export type SessionKind = "race" | "quali" | "practice";

export interface SectorCell {
  value: string;
  stale: boolean; // showing the previous lap's value
  mark: Mark;
  segments: number[];
}

export interface Row {
  num: string;
  pos: number;
  tla: string;
  name: string;
  team: string;
  color: string;
  interval: string;
  gap: string;
  battle: boolean;
  closing: number | null; // s/lap, positive = closing on car ahead
  lastLap: string;
  lastMark: Mark;
  lastSlow: boolean; // lap time not improved and not a PB
  bestLap: string;
  bestMark: Mark;
  sectors: SectorCell[];
  compound: string;
  tyreNew: boolean;
  tyreAge: number | null;
  stints: number;
  pitStops: number;
  inPit: boolean;
  pitOut: boolean;
  retired: boolean;
  stopped: boolean;
  knockedOut: boolean;
  danger: boolean; // in the elimination zone (qualifying)
  gridDelta: number | null; // + = places gained since start
  laps: number;
  speedTrap: string;
  // Qualifying / practice
  lapState: LapState;
  projection: Projection | null;
  cutDelta: string; // gap to the elimination line, signed seconds
  cutSafe: boolean;
}

export type LapState = "" | "pit" | "out" | "push" | "slow";

export interface Projection {
  time: number; // seconds
  pos: number; // grid position it would give
  mark: "ob" | "pb" | ""; // purple = fastest of the session part, green = personal improvement
  sectorsDone: number;
}

export interface Header {
  meeting: string;
  country: string;
  session: string;
  kind: SessionKind;
  part: number; // qualifying part 1..3
  lap: number | null;
  totalLaps: number | null;
  remainingMs: number | null;
  clockRunning: boolean;
  status: string;
  track: TrackState;
  weather: {
    air?: number;
    track?: number;
    humidity?: number;
    wind?: number;
    windDir?: number;
    rain: boolean;
  };
}

export interface TrackState {
  code: string;
  label: string;
  tone: "green" | "yellow" | "sc" | "vsc" | "red" | "none";
}

export interface FeedItem {
  id: string;
  utc: number;
  kind: "rc" | "radio";
  lap?: number;
  text?: string;
  flag?: string;
  category?: string;
  num?: string;
  audio?: string;
  important?: boolean;
  transcript?: Transcript;
}

export interface Transcript {
  status: "pending" | "done" | "failed";
  lines?: { speaker: "driver" | "engineer" | "unclear"; text: string }[];
  gist?: string;
  notable?: boolean;
  cleaned?: boolean;
  skipped?: boolean;
}

const TRACK: Record<string, TrackState> = {
  "1": { code: "1", label: "Track clear", tone: "green" },
  "2": { code: "2", label: "Yellow flag", tone: "yellow" },
  "4": { code: "4", label: "Safety car", tone: "sc" },
  "5": { code: "5", label: "Red flag", tone: "red" },
  "6": { code: "6", label: "Virtual safety car", tone: "vsc" },
  "7": { code: "7", label: "VSC ending", tone: "vsc" },
};

const values = (o: any): any[] => (Array.isArray(o) ? o.filter(Boolean) : o && typeof o === "object" ? Object.values(o) : []);

export function sessionKind(s: any): SessionKind {
  const type = s.SessionInfo?.Type;
  if (type === "Race") return "race";
  if (type === "Qualifying") return "quali";
  return "practice";
}

/** "1:38.220" | "38.220" → seconds */
export function lapSeconds(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(v.trim());
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
}

function gapSeconds(v: string | undefined): number | null {
  if (!v || /L|LAP/i.test(v)) return null;
  const n = Number(v.replace("+", ""));
  return Number.isFinite(n) ? n : null;
}

function parseHms(v: string | undefined): number | null {
  if (!v) return null;
  const [h, m, s] = v.split(":").map(Number);
  if ([h, m, s].some((x) => !Number.isFinite(x))) return null;
  return ((h * 60 + m) * 60 + s) * 1000;
}

function mark(o: any): Mark {
  if (o?.OverallFastest) return "ob";
  if (o?.PersonalFastest) return "pb";
  return "";
}

export function header(s: any, sessionNow: number): Header {
  const info = s.SessionInfo || {};
  const kind = sessionKind(s);
  const clock = s.ExtrapolatedClock;
  let remainingMs = parseHms(clock?.Remaining);
  if (remainingMs !== null && clock?.Extrapolating && clock.Utc) {
    remainingMs = Math.max(0, remainingMs - (sessionNow - Date.parse(clock.Utc)));
  }
  const w = s.WeatherData || {};
  const num = (v: any) => (v === undefined || v === "" ? undefined : Number(v));
  const code = String(s.TrackStatus?.Status ?? "");
  return {
    meeting: info.Meeting?.Name?.replace(/ Grand Prix$/, "") || "",
    country: info.Meeting?.Country?.Name || "",
    session: info.Name || "",
    kind,
    part: Number(s.TimingData?.SessionPart) || 0,
    lap: s.LapCount?.CurrentLap ?? null,
    totalLaps: s.LapCount?.TotalLaps ?? null,
    remainingMs,
    clockRunning: !!clock?.Extrapolating,
    status: s.SessionStatus?.Status || "",
    track: TRACK[code] || { code, label: code ? `Status ${code}` : "", tone: "none" },
    weather: {
      air: num(w.AirTemp),
      track: num(w.TrackTemp),
      humidity: num(w.Humidity),
      wind: num(w.WindSpeed),
      windDir: num(w.WindDirection),
      rain: w.Rainfall === "1" || w.Rainfall === 1,
    },
  };
}

/** Average change in interval to the car ahead over the last few laps. */
function closingRate(history: any, lap: number): number | null {
  if (!history) return null;
  const pts: number[] = [];
  for (let l = lap - 3; l <= lap; l++) {
    const g = gapSeconds(history[l]?.int);
    if (g === null || history[l]?.pit) return null;
    pts.push(g);
  }
  if (pts.length < 2) return null;
  return (pts[0] - pts[pts.length - 1]) / (pts.length - 1);
}

// Remembers where each car left the pits, so the following lap reads as an
// out-lap and the one after as the first push lap.
const pitExits = new Map<string, { session: unknown; lap: number }>();

function currentSectors(l: any): number[] {
  // When a car completes S1 the feed clears S2/S3, so filled values from the
  // front tell us how far into the current lap it is.
  const v = values(l.Sectors).map((x: any) => lapSeconds(x?.Value));
  if (v[0] !== null && v[1] === null && v[2] === null) return [v[0]!];
  if (v[0] !== null && v[1] !== null && v[2] === null) return [v[0]!, v[1]!];
  return [];
}

function lapStateFor(num: string, l: any, session: unknown, done: number[], pbSectors: (number | null)[], bestSectors: (number | null)[]): LapState {
  if (l.InPit) return "pit";
  const lap = Number(l.NumberOfLaps) || 0;
  if (l.PitOut) {
    pitExits.set(num, { session, lap });
    return "out";
  }
  const exit = pitExits.get(num);
  const sinceExit = exit && exit.session === session ? lap - exit.lap : null;
  if (sinceExit === 0) return "out";

  if (done.length) {
    // Each completed sector within a few percent of the driver's best means a push lap.
    const slow = done.some((t, i) => {
      const ref = pbSectors[i] ?? (bestSectors[i] !== null ? bestSectors[i]! * 1.02 : null);
      return ref !== null && t > ref * 1.03;
    });
    return slow ? "slow" : "push";
  }
  // Lap just started: green/purple mini-sectors, or the first lap after an out-lap.
  const s1 = values(values(l.Sectors)[0]?.Segments).map((g: any) => Number(g?.Status));
  if (s1.some((g) => g === 2049 || g === 2051)) return "push";
  if (sinceExit === 1) return "push";
  return "";
}

export function rows(s: any): Row[] {
  const lines = s.TimingData?.Lines;
  if (!lines) return [];
  const kind = sessionKind(s);
  const drivers = s.DriverList || {};
  const app = s.TimingAppData?.Lines || {};
  const stats = s.TimingStats?.Lines || {};
  const laps = s.LapHistory || {};
  const part = Number(s.TimingData?.SessionPart) || 0;
  const noEntries: number[] = s.TimingData?.NoEntries || [];
  // In Q1 the cars beyond NoEntries[1] are in the drop zone; in Q2 beyond NoEntries[2].
  const cutoff = kind === "quali" && part > 0 && part < 3 ? noEntries[part] : 0;
  const session = s.SessionInfo?.Key;
  const bestSectors: (number | null)[] = [0, 1, 2].map((i) => {
    let m: number | null = null;
    for (const n in stats) {
      const v = lapSeconds(values(stats[n]?.BestSectors)[i]?.Value);
      if (v !== null && (m === null || v < m)) m = v;
    }
    return m;
  });

  const out: Row[] = [];
  for (const num in lines) {
    const l = lines[num];
    const d = drivers[num] || {};
    if (!d.Tla && !l.Position) continue;
    const a = app[num] || {};
    const stintList = values(a.Stints);
    const stint = stintList[stintList.length - 1];
    const pos = Number(l.Position) || Number(l.Line) || 99;

    let interval = "";
    let gap = "";
    let bestLap = l.BestLapTime?.Value || "";
    if (kind === "race") {
      interval = l.IntervalToPositionAhead?.Value ?? "";
      gap = l.GapToLeader ?? "";
      if (pos === 1) {
        interval = "";
        gap = "";
      }
    } else if (kind === "quali") {
      const i = Math.max(0, part - 1);
      const st = values(l.Stats)[i];
      interval = st?.TimeDifftoPositionAhead ?? "";
      gap = st?.TimeDiffToFastest ?? "";
      bestLap = values(l.BestLapTimes)[i]?.Value || "";
    } else {
      interval = l.TimeDiffToPositionAhead ?? "";
      gap = l.TimeDiffToFastest ?? "";
    }

    const intSec = gapSeconds(interval);
    const isOut = !!(l.Retired || l.Stopped || l.KnockedOut);
    const lapsDone = Number(l.NumberOfLaps) || 0;

    const sectors: SectorCell[] = values(l.Sectors).map((sec: any) => ({
      value: sec?.Value || sec?.PreviousValue || "",
      stale: !sec?.Value && !!sec?.PreviousValue,
      mark: sec?.Value ? mark(sec) : "",
      segments: values(sec?.Segments).map((g: any) => Number(g?.Status) || 0),
    }));
    while (sectors.length < 3) sectors.push({ value: "", stale: false, mark: "", segments: [] });

    const best = stats[num]?.PersonalBestLapTime;
    const grid = Number(a.GridPos);
    const timed = kind !== "race";
    const pbSectors = [0, 1, 2].map((i) => lapSeconds(values(stats[num]?.BestSectors)[i]?.Value));
    const done = timed ? currentSectors(l) : [];
    const lapState: LapState = timed && !isOut ? lapStateFor(num, l, session, done, pbSectors, bestSectors) : "";
    out.push({
      num,
      pos,
      tla: d.Tla || num,
      name: [d.FirstName, d.LastName].filter(Boolean).join(" "),
      team: d.TeamName || "",
      color: d.TeamColour ? `#${d.TeamColour}` : "#666",
      interval,
      gap,
      battle: kind === "race" && intSec !== null && intSec < 1 && !l.InPit && !isOut,
      closing: kind === "race" ? closingRate(laps[num], lapsDone) : null,
      lastLap: l.LastLapTime?.Value || "",
      lastMark: mark(l.LastLapTime),
      lastSlow: !!l.LastLapTime?.Value && !mark(l.LastLapTime),
      bestLap,
      bestMark: best?.Position === 1 && bestLap ? "ob" : "",
      sectors: sectors.slice(0, 3),
      compound: (stint?.Compound || "").toUpperCase(),
      tyreNew: stint?.New === "true" || stint?.New === true,
      tyreAge: typeof stint?.TotalLaps === "number" ? stint.TotalLaps : null,
      stints: stintList.length,
      pitStops: Number(l.NumberOfPitStops) || 0,
      inPit: !!l.InPit,
      pitOut: !!l.PitOut,
      retired: !!l.Retired,
      stopped: !!l.Stopped,
      knockedOut: !!l.KnockedOut,
      danger: cutoff > 0 && pos > cutoff && !l.KnockedOut,
      gridDelta: kind === "race" && grid > 0 && !isOut ? grid - pos : null,
      laps: lapsDone,
      speedTrap: l.Speeds?.ST?.Value || "",
      lapState,
      projection:
        lapState === "push" && done.length && pbSectors.slice(done.length).every((x) => x !== null)
          ? { time: done.reduce((a, b) => a + b, 0) + (pbSectors.slice(done.length) as number[]).reduce((a, b) => a + b, 0), pos: 0, mark: "", sectorsDone: done.length }
          : null,
      cutDelta: "",
      cutSafe: false,
    });
  }
  out.sort((a, b) => a.pos - b.pos);

  // Where would each live push lap put the driver, and how far is everyone from the cut?
  const bests = out.map((r) => ({ num: r.num, t: lapSeconds(r.bestLap) }));
  const fastest = Math.min(...bests.map((b) => b.t ?? Infinity));
  for (const r of out) {
    if (r.projection) {
      const own = lapSeconds(r.bestLap);
      const p = r.projection.time;
      r.projection.pos = 1 + bests.filter((b) => b.num !== r.num && b.t !== null && b.t < p).length;
      r.projection.mark = p < fastest ? "ob" : own === null || p < own ? "pb" : "";
    }
  }
  if (cutoff) {
    const inside = lapSeconds(out[cutoff - 1]?.bestLap); // last car through
    const outside = lapSeconds(out[cutoff]?.bestLap); // first car out
    for (const r of out) {
      const t = lapSeconds(r.bestLap);
      if (t === null || r.knockedOut) continue;
      if (r.pos <= cutoff && outside !== null) {
        r.cutDelta = `−${(outside - t).toFixed(3)}`;
        r.cutSafe = true;
      } else if (r.pos > cutoff && inside !== null) {
        r.cutDelta = `+${(t - inside).toFixed(3)}`;
      }
    }
  }
  return out;
}

/** Race control + team radio, newest first. */
export function feedItems(s: any): FeedItem[] {
  const detected: IncidentEvent[] = values(s.Incidents?.Events);
  const items: FeedItem[] = [];
  const tla = (n: string) => s.DriverList?.[n]?.Tla || "";
  const what = { slow: "slow on track", stopped: "stopped on track", out: "out of the race" };
  detected.forEach((e, i) =>
    items.push({
      id: `in${i}`,
      utc: e.utc,
      kind: "rc",
      lap: e.lap,
      text: `CAR ${e.num} (${tla(e.num)}) ${what[e.kind]}`,
      flag: `DETECTED ${e.kind}`,
      category: "Detected",
      num: e.num,
      important: true,
    }),
  );
  const base = s.SessionInfo?.Path ? `https://livetiming.formula1.com/static/${s.SessionInfo.Path}` : "";
  values(s.RaceControlMessages?.Messages).forEach((m: any, i: number) => {
    const text: string = m.Message || "";
    items.push({
      id: `rc${i}`,
      utc: Date.parse(m.Utc.endsWith("Z") ? m.Utc : m.Utc + "Z"),
      kind: "rc",
      lap: m.Lap,
      text,
      flag: m.Flag,
      category: m.Category,
      num: m.RacingNumber,
      important:
        /PENALTY|INVESTIGAT|SAFETY CAR|RED FLAG|DISQUALIF|CHEQUERED/.test(text) ||
        ["RED", "CHEQUERED", "BLACK AND WHITE", "BLACK"].includes(m.Flag) ||
        m.Category === "SafetyCar",
    });
  });
  const transcripts = s.RadioTranscripts || {};
  values(s.TeamRadio?.Captures).forEach((c: any, i: number) => {
    const transcript: Transcript | undefined = transcripts[c.Path];
    // A radio card appears once its transcript is ready, so it arrives complete.
    // Failed or skipped clips still show (with their play button).
    if (transcript?.status === "pending") return;
    items.push({
      id: `tr${i}`,
      utc: Date.parse(c.Utc),
      kind: "radio",
      num: c.RacingNumber,
      audio: base && c.Path ? base + c.Path : undefined,
      transcript,
      important: !!transcript?.notable,
    });
  });
  return items.sort((a, b) => b.utc - a.utc);
}

/** Marshal sectors currently under yellow, from race control messages. */
export function flaggedSectors(s: any): Map<number, "yellow" | "double"> {
  const out = new Map<number, "yellow" | "double">();
  for (const m of values(s.RaceControlMessages?.Messages)) {
    if (m.Category === "Flag" && m.Scope === "Track" && (m.Flag === "GREEN" || m.Flag === "CLEAR")) out.clear();
    if (m.Scope !== "Sector" || !m.Sector) continue;
    if (m.Flag === "CLEAR" || m.Flag === "GREEN") out.delete(m.Sector);
    else if (m.Flag === "DOUBLE YELLOW") out.set(m.Sector, "double");
    else if (m.Flag === "YELLOW") out.set(m.Sector, "yellow");
  }
  return out;
}
