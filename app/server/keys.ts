import { existsSync, readFileSync, writeFileSync, mkdirSync, watchFile } from "node:fs";
import { dirname } from "node:path";

// API keys for the radio pipeline (ElevenLabs or Groq for speech-to-text,
// Anthropic for cleanup). Kept in data/keys.json, which is git-ignored; environment
// variables work as a fallback.

export type KeyName = "elevenlabs" | "groq" | "anthropic";

const ENV: Record<KeyName, string> = { elevenlabs: "ELEVENLABS_API_KEY", groq: "GROQ_API_KEY", anthropic: "ANTHROPIC_API_KEY" };

export class KeyStore {
  private file: string;
  private keys: Partial<Record<KeyName, string>> = {};
  onChange?: () => void;

  constructor(file: string) {
    this.file = file;
    this.load();
    watchFile(file, { interval: 2000 }, () => {
      const before = JSON.stringify(this.keys);
      this.load();
      if (JSON.stringify(this.keys) !== before) this.onChange?.();
    });
  }

  private load() {
    try {
      this.keys = existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : {};
    } catch {
      this.keys = {};
    }
  }

  get(name: KeyName): string | undefined {
    return this.keys[name]?.trim() || process.env[ENV[name]]?.trim() || undefined;
  }

  set(updates: Partial<Record<KeyName, string>>) {
    for (const [k, v] of Object.entries(updates) as [KeyName, string][]) {
      if (typeof v === "string" && v.trim()) this.keys[k] = v.trim();
    }
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.keys, null, 2) + "\n");
    this.onChange?.();
  }

  /** Which keys are present, never the values. */
  info() {
    return { elevenlabs: !!this.get("elevenlabs"), groq: !!this.get("groq"), anthropic: !!this.get("anthropic") };
  }
}
