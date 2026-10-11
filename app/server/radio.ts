import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Hub } from "./hub.ts";
import type { KeyStore } from "./keys.ts";

// Team radio → text. Each new capture is downloaded here (F1 blocks cloud
// IPs, so the speech service can't fetch it itself), transcribed by
// ElevenLabs Scribe (or Whisper Large v3 on Groq without an ElevenLabs key),
// then tidied by Claude Haiku with race context: speaker turns, F1
// vocabulary fixed, a one-line gist. Results enter the hub as the
// RadioTranscripts topic, so they reach the tablet through the same delay
// buffer as everything else and never spoil the TV.

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3"; // most accurate Groq speech model (Oct 2026)
const SCRIBE_URL = "https://api.elevenlabs.io/v1/speech-to-text";
// On the 2026 Singapore GP radio, Scribe recovered whole phrases Whisper mangled
// or dropped ("Grip dropping off", "If I didn't brake, we would've crashed"),
// splits speakers itself, and answers in ~0.8 s.
const SCRIBE_MODEL = "scribe_v2";
const CLEANUP_MODEL = "claude-haiku-5-5";
const CONCURRENCY = 2;
// Clips carry ~1-2 s of padding; below this they're a click or a one-word "copy"
// that Whisper can't read reliably, so they aren't worth an API call.
const MIN_CLIP_SECONDS = 4;

export const Cleaned = z.object({
  lines: z
    .array(
      z.object({
        speaker: z.enum(["driver", "engineer", "unclear"]),
        text: z.string(),
      }),
    )
    .describe("The exchange in speaking order. Empty if there was no real speech."),
  gist: z.string().describe("At most 10 words, third person, e.g. 'Told to box this lap for hards'."),
  notable: z.boolean().describe("True for strategy calls, incidents, car problems, penalties, or strong emotion."),
});

export interface RadioLine {
  speaker: "driver" | "engineer" | "unclear";
  text: string;
}

export interface RadioResult {
  status: "pending" | "done" | "failed";
  raw?: string;
  lines?: RadioLine[];
  gist?: string;
  notable?: boolean;
  cleaned?: boolean; // false when Haiku was unavailable and this is raw speech-to-text
  stt?: string; // speech model that produced `raw`
  skipped?: boolean; // too short to transcribe
  usage?: { input: number; output: number; ms: number };
  seconds?: number;
  error?: string;
}

const MP3_L3_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MP3_L3_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

/** Clip length from the first MPEG Layer III frame header (F1 radio is constant bitrate). */
export function mp3Seconds(b: Buffer): number | null {
  let i = 0;
  if (b.toString("latin1", 0, 3) === "ID3") i = 10 + (((b[6] & 127) << 21) | ((b[7] & 127) << 14) | ((b[8] & 127) << 7) | (b[9] & 127));
  for (; i < b.length - 4; i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
    const version = (b[i + 1] >> 3) & 3;
    const layer = (b[i + 1] >> 1) & 3;
    const kbps = (version === 3 ? MP3_L3_V1 : MP3_L3_V2)[b[i + 2] >> 4];
    if (layer === 1 && kbps) return ((b.length - i) * 8) / (kbps * 1000);
  }
  return null;
}

export const SYSTEM = `You tidy up machine transcripts of Formula 1 team radio for a live timing dashboard that a fan reads alongside the TV broadcast.

The audio is a short exchange between a driver and their race engineer, recorded over a noisy radio link at 300 km/h. Speech-to-text gets the gist but mishears names, jargon and numbers. Your job is to recover what was actually said, so a fan reading it gets the same information as someone listening.

How to work:
- Stay faithful. Fix mishearings when the race context or F1 vocabulary makes the intended words clear: driver and team names ("Piazzeri" is Piastri), positions ("B2" is P2), corner numbers, tyre compounds, "box", "Plan B", "lift and coast", "overtake mode", "harvesting", "delta", and homophones ("the engine is braking" means breaking). Don't add information, opinions or explanation that wasn't spoken.
- Every phrase in the transcript appears exactly once in your lines, in the order it was said. Don't repeat a phrase under two speakers.
- Split the exchange into speaker turns. The engineer addresses the driver by first name, gives instructions, positions, gaps, strategy and congratulations, and asks questions about the car. The driver reports how the car and track feel, reacts, complains and thanks the team. Use "unclear" only when neither reading is more likely.
- Keep the speakers' own words and tone, including swearing. Remove filler only when it obscures meaning ("uh", stutters).
- Mark a stretch you can't recover as [inaudible] rather than guessing. Messy or partly garbled speech is still speech: keep what you can.
- Whisper sometimes invents a stock phrase from silence or noise ("Thank you.", "Thanks for watching.", "you"). Return no lines only when the whole transcript is one of those; anything else has real speech in it.
- The raw transcript may come with speaker turns from the recogniser (S0, S1...). They're usually right about where the voice changes, but say nothing about who is the driver and who is the engineer, and sometimes merge two voices into one turn.
- Write numbers as digits, keeping how they were said: P2, Turn 10, 2.5 seconds, "high 36s", 36.5.
- The gist is for a glance from across the room: what was said or asked, in at most 10 words, without the driver's name.

The race context describes the session around the time of the clip and may be slightly later than the clip itself.`;

// Lean by choice: no thinking at low effort measured ~1.7 s median (vs 3.3 s with
// medium thinking) at half the cost, with near-identical output on most clips.
// Medium thinking was slightly better at splitting speakers on long exchanges.
export const CLEANUP_EFFORT: "low" | "medium" = "low";
export const CLEANUP_THINKING = false;

/** Haiku pass over a raw Whisper transcript. Exported so it can be evaluated on its own. */
export interface CleanupOptions {
  effort?: "low" | "medium";
  thinking?: boolean;
}

export async function cleanupTranscript(client: Anthropic, raw: string, context: string, opts: CleanupOptions = {}, turns?: string): Promise<RadioResult> {
  const effort = opts.effort ?? CLEANUP_EFFORT;
  const thinking = opts.thinking ?? CLEANUP_THINKING;
  const started = Date.now();
  const response = await client.messages.parse({
    model: CLEANUP_MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    ...(thinking ? {} : { thinking: { type: "disabled" as const } }),
    output_config: { effort, format: zodOutputFormat(Cleaned) },
    messages: [
      {
        role: "user",
        content: `<race_context>\n${context}\n</race_context>\n\n<raw_transcript>\n${raw.trim()}\n</raw_transcript>${turns ? `\n\n<speaker_turns>\n${turns}\n</speaker_turns>` : ""}`,
      },
    ],
  });

  const usage = { input: response.usage.input_tokens, output: response.usage.output_tokens, ms: Date.now() - started };
  const out = response.parsed_output;
  if (response.stop_reason === "refusal" || !out) {
    return { status: "done", raw, lines: [{ speaker: "unclear", text: raw.trim() }], cleaned: false };
  }
  // Never let the cleanup throw away real speech: an empty result is only
  // believable for Whisper's stock silence phrases.
  if (!out.lines.length && !isStockPhrase(raw)) {
    return { status: "done", raw, lines: [{ speaker: "unclear", text: raw.trim() }], gist: out.gist, notable: out.notable, cleaned: false, usage };
  }
  return { status: "done", raw, lines: out.lines, gist: out.gist, notable: out.notable, cleaned: true, usage };
}

export function makeAnthropic(apiKey: string) {
  return new Anthropic({ apiKey });
}

function isStockPhrase(raw: string): boolean {
  const t = raw.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  return !t || /^(thank you|thanks for watching|thank you for watching|you|bye|okay)( (thank you|you))*$/.test(t);
}

const values = (o: any): any[] => (Array.isArray(o) ? o.filter(Boolean) : o && typeof o === "object" ? Object.values(o) : []);

interface Job {
  key: string; // capture path within the session
  sessionPath: string;
  num: string;
  utc: string;
  raw?: string; // already transcribed; only the cleanup step is needed
  turns?: string;
}

export class RadioTranscriber {
  private hub: Hub;
  private keys: KeyStore;
  private cacheRoot: string;
  private seen = new Set<string>();
  private queue: Job[] = [];
  private active = 0;
  private anthropic?: Anthropic;
  private anthropicKey?: string;
  stats = { done: 0, failed: 0, skipped: 0, lastError: "", inputTokens: 0, outputTokens: 0 };

  constructor(hub: Hub, keys: KeyStore, cacheRoot: string) {
    this.hub = hub;
    this.keys = keys;
    this.cacheRoot = cacheRoot;
  }

  start() {
    setInterval(() => this.scan(), 500);
  }

  status() {
    return {
      enabled: !!this.sttModel(),
      keys: this.keys.info(),
      sttModel: this.sttModel(),
      cleanupModel: CLEANUP_MODEL,
      pending: this.queue.length + this.active,
      ...this.stats,
    };
  }

  private sttModel(): string | undefined {
    return this.keys.get("elevenlabs") ? SCRIBE_MODEL : this.keys.get("groq") ? GROQ_MODEL : undefined;
  }

  /** Look for captures we haven't handled yet. */
  private scan() {
    const stt = this.sttModel();
    if (!stt) return;
    const s = this.hub.state;
    const sessionPath: string | undefined = s.SessionInfo?.Path;
    if (!sessionPath) return;
    const done = s.RadioTranscripts || {};
    for (const c of values(s.TeamRadio?.Captures)) {
      if (!c?.Path) continue;
      const id = sessionPath + c.Path;
      if (this.seen.has(id) || done[c.Path]) continue;
      this.seen.add(id);
      const cached = this.readCache(sessionPath, c.Path);
      const job: Job = { key: c.Path, sessionPath, num: String(c.RacingNumber), utc: c.Utc };
      // Transcribed by a weaker speech model than we now have: do it again (the audio is cached).
      if (cached && !cached.skipped && stt === SCRIBE_MODEL && cached.stt !== SCRIBE_MODEL) {
        this.emit(c.Path, cached);
        this.queue.push(job);
        continue;
      }
      if (cached) {
        this.emit(c.Path, cached);
        // Transcribed before the Anthropic key was added: tidy it up now, without re-paying for speech-to-text.
        if (!cached.cleaned && cached.raw && this.keys.get("anthropic")) this.queue.unshift({ ...job, raw: cached.raw });
        continue;
      }
      this.emit(c.Path, { status: "pending" });
      this.queue.push(job);
    }
    this.pump();
  }

  private pump() {
    while (this.active < CONCURRENCY && this.queue.length) {
      // Newest first: during a live session the latest clip matters most.
      const job = this.queue.pop()!;
      this.active++;
      this.process(job)
        .catch((err) => {
          this.stats.failed++;
          this.stats.lastError = String(err?.message || err).slice(0, 200);
          console.warn(`[radio] ${job.key}: ${this.stats.lastError}`);
          this.emit(job.key, { status: "failed", error: this.stats.lastError });
        })
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }

  private async process(job: Job) {
    const t0 = Date.now();
    let tAudio = 0;
    let tStt = 0;
    let raw = job.raw;
    let turns = job.turns;
    const stt = this.sttModel();
    if (raw === undefined) {
      const audio = await this.download(job);
      tAudio = Date.now() - t0;
      const seconds = mp3Seconds(audio);
      if (seconds !== null && seconds < MIN_CLIP_SECONDS) {
        const skipped: RadioResult = { status: "done", lines: [], skipped: true, seconds, cleaned: true };
        this.writeCache(job.sessionPath, job.key, skipped);
        this.emit(job.key, skipped);
        this.stats.skipped++;
        return;
      }
      if (stt === SCRIBE_MODEL) ({ raw, turns } = await this.scribe(audio, job));
      else raw = await this.transcribe(audio, job);
      tStt = Date.now() - t0 - tAudio;
    }
    let result: RadioResult;
    try {
      // Punctuation-only output (very short or silent clips) has nothing to clean.
      result = /[a-z0-9]/i.test(raw) ? await this.cleanup(raw, job, turns) : { status: "done", raw, lines: [], gist: "No clear speech", notable: false, cleaned: true };
    } catch (err: any) {
      // Raw Whisper text is still useful if the cleanup step is unavailable.
      this.stats.lastError = `cleanup: ${String(err?.message || err).slice(0, 160)}`;
      result = { status: "done", raw, lines: [{ speaker: "unclear", text: raw.trim() }], cleaned: false };
    }
    result.stt = job.raw === undefined ? stt : this.readCache(job.sessionPath, job.key)?.stt;
    this.writeCache(job.sessionPath, job.key, result);
    this.emit(job.key, result);
    this.stats.done++;
    this.stats.inputTokens += result.usage?.input ?? 0;
    this.stats.outputTokens += result.usage?.output ?? 0;
    const age = job.utc ? ((Date.now() - Date.parse(job.utc)) / 1000).toFixed(1) : "?";
    console.log(
      `[radio] ${basename(job.key)}: audio ${(tAudio / 1000).toFixed(1)}s, ${stt === SCRIBE_MODEL ? "scribe" : "whisper"} ${(tStt / 1000).toFixed(1)}s, haiku ${((result.usage?.ms ?? 0) / 1000).toFixed(1)}s; ${age}s after the clip's timestamp`,
    );
  }

  private async download(job: Job): Promise<Buffer> {
    const dir = this.cacheDir(job.sessionPath);
    const file = join(dir, basename(job.key));
    if (existsSync(file)) return readFileSync(file);
    const res = await fetch(`https://livetiming.formula1.com/static/${job.sessionPath}${job.key}`, {
      headers: { "User-Agent": "BestHTTP" },
    });
    if (!res.ok) throw new Error(`audio HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(file, buf);
    return buf;
  }

  /** ElevenLabs Scribe, primed with this race's names and radio jargon, with its own speaker split. */
  private async scribe(audio: Buffer, job: Job, attempt = 0): Promise<{ raw: string; turns: string }> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), basename(job.key));
    form.append("model_id", SCRIBE_MODEL);
    form.append("language_code", "en");
    form.append("diarize", "true");
    form.append("tag_audio_events", "false");
    for (const t of this.keyterms(job.num)) form.append("keyterms", t);

    const res = await fetch(SCRIBE_URL, { method: "POST", headers: { "xi-api-key": this.keys.get("elevenlabs")! }, body: form });
    if (res.status === 429 && attempt < 4) {
      const wait = Number(res.headers.get("retry-after")) || 2 ** attempt * 3;
      await new Promise((r) => setTimeout(r, wait * 1000));
      return this.scribe(audio, job, attempt + 1);
    }
    if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const body = await res.json();
    const turns: { s: string; w: string[] }[] = [];
    for (const w of body.words || []) {
      if (w.type !== "word") continue;
      const last = turns[turns.length - 1];
      if (last && last.s === w.speaker_id) last.w.push(w.text);
      else turns.push({ s: w.speaker_id, w: [w.text] });
    }
    return {
      raw: String(body.text || "").trim(),
      turns: turns.length > 1 ? turns.map((t) => `${String(t.s).replace("speaker_", "S")}: ${t.w.join(" ")}`).join("\n") : "",
    };
  }

  /** Words Scribe should expect: everyone's names, this driver's team, radio jargon. */
  private keyterms(num: string): string[] {
    const me = this.hub.state.DriverList?.[num] || {};
    const names = values(this.hub.state.DriverList).map((d: any) => d.LastName);
    const jargon = ["box", "Plan B", "Plan C", "overtake mode", "harvesting", "lift and coast", "delta", "deg", "graining", "undercut", "overcut", "softs", "mediums", "hards", "inters", "Safety Car", "VSC", "track limits", "copy"];
    return [...new Set([me.FirstName, me.TeamName, ...names, ...jargon].filter((t) => t && t.length < 50))].slice(0, 100);
  }

  private async transcribe(audio: Buffer, job: Job, attempt = 0): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), basename(job.key));
    form.append("model", GROQ_MODEL);
    form.append("language", "en");
    form.append("temperature", "0");
    form.append("response_format", "verbose_json");
    form.append("prompt", this.vocabulary(job.num));

    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.keys.get("groq")}` },
      body: form,
    });
    if (res.status === 429 && attempt < 4) {
      const wait = Number(res.headers.get("retry-after")) || 2 ** attempt * 3;
      await new Promise((r) => setTimeout(r, wait * 1000));
      return this.transcribe(audio, job, attempt + 1);
    }
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const body = await res.json();
    // Drop segments Whisper itself thinks were silence; that's where it hallucinates.
    const segments: any[] = Array.isArray(body.segments) ? body.segments : [];
    if (!segments.length) return body.text || "";
    return segments
      .filter((s) => !(s.no_speech_prob > 0.7 && s.avg_logprob < -0.8))
      .map((s) => String(s.text).trim())
      .join(" ");
  }

  /** Whisper's prompt biases spelling: names and radio jargon (max ~224 tokens). */
  private vocabulary(num: string): string {
    const drivers = this.hub.state.DriverList || {};
    const d = drivers[num] || {};
    const names = values(drivers)
      .map((x: any) => x.LastName)
      .filter(Boolean)
      .join(", ");
    const head = `Formula 1 team radio, ${d.FirstName ?? ""} ${d.LastName ?? ""} (${d.TeamName ?? "team"}) and race engineer.`;
    const terms = "Box, box. Plan B. Copy. Understood. Softs, mediums, hards, inters. Safety Car, VSC. Overtake mode, harvesting, lift and coast, delta, deg, graining. Turn 1.";
    return `${head} ${terms} ${names}.`.slice(0, 850);
  }

  private async cleanup(raw: string, job: Job, turns?: string): Promise<RadioResult> {
    const key = this.keys.get("anthropic");
    if (!key) return { status: "done", raw, lines: [{ speaker: "unclear", text: raw.trim() }], cleaned: false };
    if (!this.anthropic || this.anthropicKey !== key) {
      this.anthropic = new Anthropic({ apiKey: key });
      this.anthropicKey = key;
    }
    return cleanupTranscript(this.anthropic, raw, this.context(job), {}, turns);
  }

  private context(job: Job): string {
    const s = this.hub.state;
    const d = s.DriverList?.[job.num] || {};
    const line = s.TimingData?.Lines?.[job.num] || {};
    const stints = values(s.TimingAppData?.Lines?.[job.num]?.Stints);
    const stint = stints[stints.length - 1];
    const byPos = new Map<number, string>();
    for (const [n, l] of Object.entries<any>(s.TimingData?.Lines || {})) byPos.set(Number(l.Position), s.DriverList?.[n]?.LastName ?? n);
    const pos = Number(line.Position);
    const rc = values(s.RaceControlMessages?.Messages)
      .filter((m: any) => !m.Utc || Date.parse(m.Utc.endsWith("Z") ? m.Utc : m.Utc + "Z") <= Date.parse(job.utc) + 5000)
      .slice(-4)
      .map((m: any) => `- ${m.Message}`)
      .join("\n");
    return [
      `Session: ${s.SessionInfo?.Meeting?.Name ?? ""}, ${s.SessionInfo?.Name ?? ""}`,
      s.LapCount ? `Lap ${s.LapCount.CurrentLap} of ${s.LapCount.TotalLaps}` : "",
      `Driver: ${d.FirstName ?? ""} ${d.LastName ?? ""}, car ${job.num}, ${d.TeamName ?? ""}`,
      pos ? `Running P${pos}${byPos.get(pos - 1) ? `, behind ${byPos.get(pos - 1)}` : ""}${byPos.get(pos + 1) ? `, ahead of ${byPos.get(pos + 1)}` : ""}` : "",
      line.IntervalToPositionAhead?.Value ? `Gap to car ahead: ${line.IntervalToPositionAhead.Value}` : "",
      stint ? `Tyres: ${stint.Compound}, ${stint.TotalLaps ?? "?"} laps old; pit stops so far: ${line.NumberOfPitStops ?? 0}` : "",
      `Track status: ${s.TrackStatus?.Message ?? "unknown"}`,
      rc ? `Recent race control messages:\n${rc}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private emit(key: string, result: RadioResult) {
    this.hub.ingest("RadioTranscripts", { [key]: result });
  }

  private cacheDir(sessionPath: string) {
    const dir = join(this.cacheRoot, sessionPath.replace(/[\\/:*?"<>|]+/g, "_"));
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private readCache(sessionPath: string, key: string): RadioResult | null {
    const file = join(this.cacheDir(sessionPath), basename(key) + ".json");
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  }

  private writeCache(sessionPath: string, key: string, result: RadioResult) {
    writeFileSync(join(this.cacheDir(sessionPath), basename(key) + ".json"), JSON.stringify(result));
  }
}
