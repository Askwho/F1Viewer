import { existsSync, readFileSync, writeFileSync, watchFile, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// The F1 TV subscription token unlocks car positions and telemetry on the
// live feed. It comes from the `login-session` cookie on formula1.com, which
// is URL-encoded JSON holding data.subscriptionToken (a JWT, valid ~1 week).
// We accept either the whole cookie value or the bare JWT.

export function extractToken(input: string): string | null {
  let s = input.trim().replace(/^login-session=/, "");
  if (!s) return null;
  if (s.startsWith("%7B") || s.startsWith("%7b")) s = decodeURIComponent(s);
  if (s.startsWith("{")) {
    try {
      const j = JSON.parse(s);
      s = j?.data?.subscriptionToken || j?.subscriptionToken || "";
    } catch {
      return null;
    }
  }
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(s) ? s : null;
}

export function describeToken(token: string | null) {
  if (!token) return { present: false as const };
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    const exp = typeof payload.exp === "number" ? payload.exp * 1000 : null;
    return {
      present: true as const,
      subscription: payload.SubscriptionStatus ?? payload.subscriptionStatus ?? null,
      product: payload.SubscribedProduct ?? payload.subscribedProduct ?? null,
      expires: exp ? new Date(exp).toISOString() : null,
      expired: exp ? exp < Date.now() : false,
    };
  } catch {
    return { present: true as const, subscription: null, product: null, expires: null, expired: false };
  }
}

export class TokenStore {
  private current: string | null = null;
  onChange?: () => void;

  private file: string;

  constructor(file: string) {
    this.file = file;
    this.load();
    // Editing the file by hand takes effect without restarting the relay.
    watchFile(file, { interval: 2000 }, () => {
      const before = this.current;
      this.load();
      if (this.current !== before) this.onChange?.();
    });
  }

  private load() {
    const fromEnv = process.env.F1TV_TOKEN ? extractToken(process.env.F1TV_TOKEN) : null;
    const fromFile = existsSync(this.file) ? extractToken(readFileSync(this.file, "utf8")) : null;
    this.current = fromFile || fromEnv;
  }

  token() {
    const info = describeToken(this.current);
    return info.present && !info.expired ? this.current : null;
  }

  info() {
    return describeToken(this.current);
  }

  set(input: string): boolean {
    const t = extractToken(input);
    if (!t) return false;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, t + "\n");
    this.current = t;
    this.onChange?.();
    return true;
  }
}
