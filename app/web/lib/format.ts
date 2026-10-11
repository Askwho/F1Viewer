export function clock(ms: number | null): string {
  if (ms === null) return "";
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "+1.204" → "+1.204", "1L" → "+1 LAP", "LAP 19" → "" */
export function gap(v: string): string {
  if (!v) return "";
  if (/^LAP/i.test(v)) return "";
  const lapped = /^\+?(\d+)\s*L(APS?)?$/i.exec(v);
  if (lapped) return `+${lapped[1]} LAP${lapped[1] === "1" ? "" : "S"}`;
  return v.startsWith("+") || v.startsWith("-") ? v : `+${v}`;
}

export function compoundLetter(c: string): string {
  return { SOFT: "S", MEDIUM: "M", HARD: "H", INTERMEDIATE: "I", WET: "W" }[c] || (c ? "?" : "");
}

export function localTime(utc: number): string {
  if (!utc) return "";
  return new Date(utc).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Timing feed segment status → colour class */
export function segmentClass(status: number): string {
  switch (status) {
    case 2051:
      return "ob";
    case 2049:
      return "pb";
    case 2048:
      return "y";
    case 2064:
      return "pit";
    case 0:
      return "";
    default:
      return "dim";
  }
}

/** 92.413 → "1:32.41" (two decimals: projections are estimates) */
export function lapTime(sec: number, decimals = 2): string {
  const m = Math.floor(sec / 60);
  const rest = (sec - m * 60).toFixed(decimals).padStart(decimals + 3, "0");
  return m ? `${m}:${rest}` : rest;
}
