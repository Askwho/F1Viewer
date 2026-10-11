// Replays a recorded session through the incident detector.
//   npm test      (RECORDING=path.jsonl.gz to use another)
// Default recording: 2026 Singapore GP race, where Bortoleto (5) slowed on lap 8
// at ~12:15:40Z, stopped by ~12:16:05Z and switched off by ~12:16:20Z.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createReadStream, existsSync } from "node:fs";
import { createGunzip, constants } from "node:zlib";
import { createInterface } from "node:readline";
import { merge } from "./merge.ts";
import { Incidents, contextFrom, ingest, type IncidentEvent } from "./incidents.ts";

const FILE = process.env.RECORDING || new URL("../data/recordings/2026-10-11T12-01-37-860Z.jsonl.gz", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");

async function replay(until = Infinity, joinAt = 0) {
  let inc = new Incidents();
  let joined = !joinAt;
  const raw: Record<string, any> = {};
  const seen = new Map<string, Set<string>>(); // kinds each car was flagged with
  let last = 0;
  const input = createReadStream(FILE).pipe(createGunzip({ finishFlush: constants.Z_SYNC_FLUSH }));
  input.on("error", () => {}); // the live recording may still be open (no gzip trailer)
  const rl = createInterface({ input });
  try {
    for await (const line of rl) {
      let m: any;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      if (m.t > until) break;
      if (m.topic === "__reset") continue;
      raw[m.topic] = merge(raw[m.topic], m.data);
      if (!joined && m.t >= joinAt) {
        // What the dashboard does on connecting: a fresh detector fed the merged snapshot.
        joined = true;
        inc = new Incidents();
        inc.setContext(contextFrom(raw));
        ingest(inc, "CarData", raw.CarData);
        ingest(inc, "Position", raw.Position);
        continue;
      }
      if (!joined) continue;
      if (m.topic === "SessionStatus" || m.topic === "TrackStatus" || m.topic === "TimingData") inc.setContext(contextFrom(raw));
      last = m.t;
      if (m.topic === "CarData" || m.topic === "Position") {
        ingest(inc, m.topic, m.data);
        for (const [num, i] of inc.evaluate()) {
          if (!seen.has(num)) seen.set(num, new Set());
          seen.get(num)!.add(i.kind);
        }
      }
    }
  } catch {}
  return { inc, seen, last };
}

test("a dashboard opened after the stop still catches it", { skip: (!!process.env.RECORDING && "another recording") || (!existsSync(FILE) && "no recording") }, async () => {
  const { inc } = await replay(Date.parse("2026-10-11T12:17:30Z"), Date.parse("2026-10-11T12:17:00Z"));
  assert.equal(inc.evaluate().get("5")?.kind, "out");
  // It happened before we joined, so we can't say when: no misdated feed entry.
  assert.deepEqual(inc.events, []);
});

const at = (e: IncidentEvent | undefined) => (e ? new Date(e.utc).toISOString().slice(11, 19) : "never");

test("Bortoleto's stop: slow, then stopped, then out", { skip: (!!process.env.RECORDING && "another recording") || (!existsSync(FILE) && "no recording") }, async () => {
  const { inc } = await replay(Date.parse("2026-10-11T12:20:00Z"));
  const bor = inc.events.filter((e) => e.num === "5");
  const first = (k: string) => bor.find((e) => e.kind === k);
  console.log("BOR events:", bor.map((e) => `${at(e)} ${e.kind}`).join(", "));
  const stopped = first("stopped");
  const out = first("out");
  assert.ok(stopped, "stopped detected");
  assert.ok(out, "out detected");
  assert.ok(stopped.utc >= Date.parse("2026-10-11T12:15:40Z") && stopped.utc <= Date.parse("2026-10-11T12:16:20Z"), `stopped at ${at(stopped)}`);
  assert.ok(out.utc <= Date.parse("2026-10-11T12:16:50Z"), `out at ${at(out)}`);
  const slow = first("slow");
  if (slow) assert.ok(slow.utc >= Date.parse("2026-10-11T12:15:30Z"), `slow at ${at(slow)}`);
});

test("no false alarms for anyone else in green running", { skip: !existsSync(FILE) && "no recording" }, async () => {
  const { inc, last } = await replay();
  console.log("Replayed to", new Date(last).toISOString().slice(11, 19));
  const others = inc.events.filter((e) => e.num !== "5");
  console.log("Other events:", others.map((e) => `${at(e)} #${e.num} ${e.kind}`).join(", ") || "none");
  assert.deepEqual(others, []);
});

test("the relay logs incidents into the shared state", { skip: (!!process.env.RECORDING && "another recording") || (!existsSync(FILE) && "no recording") }, async () => {
  const { Hub } = await import("../server/hub.ts");
  const hub = new Hub();
  const input = createReadStream(FILE).pipe(createGunzip({ finishFlush: constants.Z_SYNC_FLUSH }));
  input.on("error", () => {});
  try {
    for await (const line of createInterface({ input })) {
      const m = JSON.parse(line);
      if (m.t > Date.parse("2026-10-11T12:17:00Z")) break;
      if (m.topic !== "__reset") hub.ingest(m.topic, m.data, m.t);
    }
  } catch {}
  const events = Object.values(hub.state.Incidents?.Events ?? {}) as IncidentEvent[];
  assert.deepEqual(
    events.map((e) => `${e.num} ${e.kind} L${e.lap}`),
    ["5 slow L8", "5 stopped L8", "5 out L8"],
  );
});
