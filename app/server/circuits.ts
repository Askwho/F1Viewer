import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Circuit outlines from MultiViewer's public API, cached on disk forever.
// Coordinates share units with Position.z X/Y, so cars drop straight on.

export async function getCircuit(key: number, year: number, cacheDir: string) {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, `${key}-${year}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const traced = join(cacheDir, `${key}-traced.json`);
  const res = await fetch(`https://api.multiviewer.app/api/v1/circuits/${key}/${year}`, {
    headers: { "User-Agent": "f1viewer-live (personal dashboard)" },
  });
  if (!res.ok) {
    // Unknown to MultiViewer (a new venue): use an outline traced from car positions, if we have one.
    if (existsSync(traced)) return JSON.parse(readFileSync(traced, "utf8"));
    return null;
  }
  const c = await res.json();
  const slim = {
    x: c.x,
    y: c.y,
    rotation: c.rotation,
    corners: (c.corners || []).map((k: any) => ({ n: k.number, l: k.letter, x: k.trackPosition.x, y: k.trackPosition.y, a: k.angle })),
    sectors: (c.marshalSectors || []).map((k: any) => ({ n: k.number, x: k.trackPosition.x, y: k.trackPosition.y })),
  };
  writeFileSync(file, JSON.stringify(slim));
  return slim;
}

export function saveTraced(key: number, outline: unknown, cacheDir: string) {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, `${key}-traced.json`), JSON.stringify(outline));
}
