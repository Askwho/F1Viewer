import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hub } from "../hub.ts";
import { TOPICS } from "./live.ts";

// Replays a finished session from F1's public archive through the hub, so
// the app behaves exactly as it would live. Used for development and for
// watching sessions back between race weekends.

const STATIC = "https://livetiming.formula1.com/static/";
const UA = "BestHTTP";

interface Event {
  ms: number; // offset from archive start
  topic: string;
  data: unknown;
}

async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  return (await res.text()).replace(/^\uFEFF/, "");
}

function parseOffset(s: string): number {
  const [h, m, sec] = s.split(":");
  return (Number(h) * 3600 + Number(m) * 60 + Number(sec)) * 1000;
}

export async function loadArchive(path: string, cacheRoot: string): Promise<Event[]> {
  if (!path.endsWith("/")) path += "/";
  const dir = join(cacheRoot, path.replace(/[\\/:*?"<>|]+/g, "_"));
  mkdirSync(dir, { recursive: true });

  const index = JSON.parse((await fetchText(STATIC + path + "Index.json")) || "null");
  if (!index?.Feeds) throw new Error(`No archive index at ${path} (still generating?)`);

  const events: Event[] = [];
  const topics = TOPICS.filter((t) => index.Feeds[t]);
  await Promise.all(
    topics.map(async (topic) => {
      const file = join(dir, `${topic}.jsonStream`);
      let text = existsSync(file) ? readFileSync(file, "utf8") : null;
      if (text === null) {
        text = await fetchText(STATIC + path + index.Feeds[topic].StreamPath);
        if (text === null) return;
        writeFileSync(file, text);
      }
      for (const line of text.split(/\r?\n/)) {
        const m = /^(\d+:\d\d:\d\d\.\d+)(.*)$/.exec(line);
        if (!m) continue;
        try {
          events.push({ ms: parseOffset(m[1]), topic, data: JSON.parse(m[2]) });
        } catch {}
      }
    }),
  );
  events.sort((a, b) => a.ms - b.ms);
  return events;
}

/** Find where to begin: "start" (just before the session goes green), "lap:N", or "h:mm:ss". */
function resolveFrom(events: Event[], from: string): number {
  if (!from || from === "0") return 0;
  if (from === "start") {
    const e = events.find((e) => e.topic === "SessionStatus" && (e.data as any)?.Status === "Started");
    return e ? Math.max(0, e.ms - 60_000) : 0;
  }
  const lap = /^lap:(\d+)$/.exec(from);
  if (lap) {
    const n = Number(lap[1]);
    const e = events.find((e) => e.topic === "LapCount" && (e.data as any)?.CurrentLap >= n);
    return e ? e.ms : 0;
  }
  return parseOffset(from);
}

export async function startReplay(hub: Hub, path: string, cacheRoot: string, opts: { from?: string; speed?: number }) {
  const speed = opts.speed || 1;
  hub.setStatus("replay", `loading ${path}`, false);
  const events = await loadArchive(path, cacheRoot);
  const fromMs = resolveFrom(events, opts.from || "start");

  // Archive offsets are relative; Heartbeat carries real UTC so we can map
  // offsets to session time (needed for clocks that extrapolate).
  const hb = events.find((e) => e.topic === "Heartbeat" && (e.data as any)?.Utc);
  const utcAtZero = hb ? Date.parse((hb.data as any).Utc) - hb.ms : Date.now();

  hub.reset();
  // Fast-forward to the start point. Sample streams only need their latest value.
  let i = 0;
  const lastSample: Record<string, Event> = {};
  for (; i < events.length && events[i].ms < fromMs; i++) {
    const e = events[i];
    if (e.topic.endsWith(".z")) lastSample[e.topic] = e;
    else hub.ingest(e.topic, e.data);
  }
  for (const e of Object.values(lastSample)) hub.ingest(e.topic, e.data);

  const wallStart = Date.now();
  // Session UTC for a server time t is utc + (t - base) * speed.
  hub.ingest("__clock", { base: wallStart, utc: utcAtZero + fromMs, speed }, Date.now(), true);
  hub.snapshotNow();
  hub.setStatus("replay", `${path} from ${opts.from || "start"} at ${speed}×`, true);
  console.log(`[replay] ${events.length} events; starting at offset ${Math.round(fromMs / 1000)}s, ${speed}×`);

  const timer = setInterval(() => {
    const due = fromMs + (Date.now() - wallStart) * speed;
    while (i < events.length && events[i].ms <= due) {
      const e = events[i++];
      hub.ingest(e.topic, e.data);
    }
    if (i >= events.length) {
      clearInterval(timer);
      hub.setStatus("replay", `${path} finished`, true);
    }
  }, 50);
  return () => clearInterval(timer);
}
