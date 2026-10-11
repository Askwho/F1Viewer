// Fallback circuit outline for venues MultiViewer doesn't know (new tracks
// like Madrid or Sepang): follow cars' positions until one completes a clean
// lap, and use that loop as the map. Rotation is chosen to fill a landscape box.

interface Pt {
  x: number;
  y: number;
  t: number;
  d: number; // cumulative distance travelled
}

const CLOSE_DIST = 400; // feed units (~decimetres)
const MIN_LAP_MS = 55_000;
const MAX_LAP_MS = 240_000;
const MIN_LAP_LENGTH = 25_000; // ~2.5 km: rules out parked or crawling cars

export interface Outline {
  x: number[];
  y: number[];
  rotation: number;
  corners: never[];
  sectors: never[];
  traced: true;
}

export class Tracer {
  private paths = new Map<string, Pt[]>();
  result: Outline | null = null;

  /** Feed a decoded Position message; `isClean(num)` says the car isn't in the pits. */
  observe(pos: any, isClean: (num: string) => boolean): Outline | null {
    if (this.result || !Array.isArray(pos?.Position)) return null;
    for (const batch of pos.Position) {
      const t = Date.parse(batch.Timestamp);
      for (const num in batch.Entries) {
        const e = batch.Entries[num];
        let path = this.paths.get(num);
        if (!path) this.paths.set(num, (path = []));
        if (e.Status !== "OnTrack" || (!e.X && !e.Y) || !isClean(num)) {
          path.length = 0; // a pit visit or garage time spoils the lap
          continue;
        }
        const last = path[path.length - 1];
        if (last && last.t >= t) continue;
        const p = { x: e.X, y: e.Y, t, d: last ? last.d + Math.hypot(e.X - last.x, e.Y - last.y) : 0 };
        path.push(p);
        while (path.length && t - path[0].t > MAX_LAP_MS) path.shift();

        // Did we just come back to somewhere we were one lap ago?
        for (let i = 0; i < path.length - 1; i++) {
          const q = path[i];
          if (t - q.t < MIN_LAP_MS) break;
          if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 < CLOSE_DIST ** 2) {
            if (p.d - q.d < MIN_LAP_LENGTH) break;
            this.result = finish(path.slice(i));
            return this.result;
          }
        }
      }
    }
    return null;
  }
}

function finish(loop: Pt[]): Outline {
  const x = loop.map((p) => Math.round(p.x));
  const y = loop.map((p) => Math.round(p.y));
  // Pick the rotation that makes the outline widest relative to its height.
  let best = 0;
  let bestScore = -Infinity;
  for (let deg = 0; deg < 180; deg += 3) {
    const a = (deg * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < x.length; i++) {
      const rx = x[i] * c - y[i] * s;
      const ry = x[i] * s + y[i] * c;
      minX = Math.min(minX, rx);
      maxX = Math.max(maxX, rx);
      minY = Math.min(minY, ry);
      maxY = Math.max(maxY, ry);
    }
    // Fit into a ~4:3 box and maximise the resulting scale.
    const scale = Math.min(4 / (maxX - minX), 3 / (maxY - minY));
    if (scale > bestScore) {
      bestScore = scale;
      best = deg;
    }
  }
  return { x, y, rotation: best, corners: [], sectors: [], traced: true };
}
