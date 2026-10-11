// Derives a per-driver lap history (LapHistory topic) from TimingData so that
// gap trends, closing rates and charts survive reconnects. The feed only ever
// tells us "now"; this remembers what each completed lap looked like.

export interface LapRec {
  time?: string; // lap time "1:38.220"
  gap?: string; // to leader "+4.919" | "1L"
  int?: string; // to car ahead
  pos?: number;
  pit?: boolean;
  cmp?: string; // tyre compound
  age?: number; // tyre age in laps
}

// Lap time, gaps and position for a lap can arrive a few messages after the
// lap counter ticks over, so keep patching the record for a short window.
const PATCH_WINDOW_MS = 6000;

export class LapRecorder {
  private seen = new Map<string, { lap: number; at: number; key: string }>();

  observe(state: Record<string, any>, t: number): Record<string, Record<string, LapRec>> | null {
    const lines = state.TimingData?.Lines;
    if (!lines) return null;
    let delta: Record<string, Record<string, LapRec>> | null = null;

    for (const num in lines) {
      const l = lines[num];
      const lap = l?.NumberOfLaps;
      if (typeof lap !== "number" || lap < 1) continue;

      const stints = state.TimingAppData?.Lines?.[num]?.Stints;
      const stint = Array.isArray(stints) ? stints[stints.length - 1] : undefined;
      const rec: LapRec = {
        time: l.LastLapTime?.Value || undefined,
        gap: l.GapToLeader || undefined,
        int: l.IntervalToPositionAhead?.Value || undefined,
        pos: Number(l.Position) || undefined,
        pit: l.InPit || l.PitOut || undefined,
        cmp: stint?.Compound || undefined,
        age: typeof stint?.TotalLaps === "number" ? stint.TotalLaps : undefined,
      };
      const key = JSON.stringify(rec);
      const prev = this.seen.get(num);

      const isNewLap = !prev || lap > prev.lap;
      const isPatch = prev && lap === prev.lap && t - prev.at < PATCH_WINDOW_MS && key !== prev.key;
      if (!isNewLap && !isPatch) continue;

      this.seen.set(num, { lap, at: isNewLap ? t : prev!.at, key });
      delta ??= {};
      (delta[num] ??= {})[lap] = rec;
    }
    return delta;
  }
}
