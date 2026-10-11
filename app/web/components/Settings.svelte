<script lang="ts">
  import { feed } from "../lib/feed.svelte.ts";

  let { onclose, isRace }: { onclose: () => void; isRace: boolean } = $props();

  let tokenInput = $state("");
  let tokenMsg = $state("");
  let info = $state<any>(null);
  let syncMsg = $state("");
  let elevenKey = $state("");
  let groqKey = $state("");
  let anthropicKey = $state("");
  let keyMsg = $state("");

  async function saveKeys() {
    keyMsg = "Saving…";
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ elevenlabs: elevenKey, groq: groqKey, anthropic: anthropicKey }),
    });
    keyMsg = res.ok ? "Saved. New radio clips will be transcribed." : "Couldn't save the keys.";
    if (res.ok) {
      elevenKey = "";
      groqKey = "";
      anthropicKey = "";
    }
    refresh();
  }

  async function refresh() {
    try {
      info = await (await fetch("/api/status")).json();
    } catch {
      info = null;
    }
  }
  refresh();

  async function saveToken() {
    tokenMsg = "Saving…";
    const res = await fetch("/api/token", { method: "POST", body: tokenInput });
    const body = await res.json();
    tokenMsg = res.ok ? "Saved. Reconnecting to the feed with it…" : body.error;
    if (res.ok) tokenInput = "";
    setTimeout(refresh, 4000);
    refresh();
  }

  function nudge(s: number) {
    feed.setDelay(feed.delayMs + s * 1000);
  }

  function syncNow() {
    syncMsg = feed.syncToLeaderCrossing()
      ? "Synced: the dashboard now matches your TV."
      : "No lap completed yet. Try again after the leader crosses the line.";
  }

  const seconds = $derived(Math.round(feed.delayMs / 1000));
  const tok = $derived(info?.token);
  const radio = $derived(info?.radio);
</script>

<div class="scrim" onclick={onclose} role="presentation"></div>
<div class="sheet" role="dialog" aria-label="Settings">
  <section>
    <h2>Broadcast delay</h2>
    <p class="hint">The timing feed runs well ahead of TV. Hold it back so nothing is spoiled.</p>
    <div class="delay">
      <button onclick={() => nudge(-5)}>−5</button>
      <button onclick={() => nudge(-1)}>−1</button>
      <div class="value num">{seconds}<small>s</small></div>
      <button onclick={() => nudge(1)}>+1</button>
      <button onclick={() => nudge(5)}>+5</button>
    </div>
    <input
      type="range"
      min="0"
      max="120"
      step="1"
      value={seconds}
      oninput={(e) => feed.setDelay(Number((e.target as HTMLInputElement).value) * 1000)}
    />
    {#if isRace}
      <button class="primary" onclick={syncNow}>Leader is crossing the line on TV now</button>
      <p class="hint">Tap the moment the leader crosses the line on your TV to set the delay automatically.</p>
      {#if syncMsg}<p class="ok">{syncMsg}</p>{/if}
    {/if}
    <button class="ghost" onclick={() => feed.setDelay(0)}>Reset to live</button>
  </section>

  <section>
    <h2>F1 TV token</h2>
    <p class="hint">Unlocks live car positions on the map. Lasts about a week.</p>
    <div class="tokstate">
      {#if !tok?.present}
        <span class="pill">Not set</span>
      {:else if tok.expired}
        <span class="pill bad">Expired</span>
      {:else}
        <span class="pill good">{tok.subscription || "Set"}</span>
        {#if tok.expires}<span class="hint">expires {new Date(tok.expires).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>{/if}
      {/if}
    </div>
    <textarea bind:value={tokenInput} rows="3" placeholder="Paste the login-session cookie value (or the token itself)" spellcheck="false"></textarea>
    <button class="primary" disabled={!tokenInput.trim()} onclick={saveToken}>Save token</button>
    {#if tokenMsg}<p class="ok">{tokenMsg}</p>{/if}
  </section>

  <section>
    <h2>Radio transcripts</h2>
    <p class="hint">ElevenLabs Scribe transcribes each clip (Whisper on Groq without an ElevenLabs key); Claude Haiku tidies it up with race context.</p>
    <div class="tokstate">
      <span class="pill" class:good={radio?.keys?.elevenlabs}>ElevenLabs {radio?.keys?.elevenlabs ? "set" : "not set"}</span>
      <span class="pill" class:good={radio?.keys?.groq}>Groq {radio?.keys?.groq ? "set" : "not set"}</span>
      <span class="pill" class:good={radio?.keys?.anthropic}>Anthropic {radio?.keys?.anthropic ? "set" : "not set"}</span>
    </div>
    {#if radio?.enabled}
      <p class="hint">{radio.done} transcribed{radio.pending ? ` · ${radio.pending} in progress` : ""}{radio.failed ? ` · ${radio.failed} failed` : ""}</p>
      {#if radio.lastError}<p class="hint err">{radio.lastError}</p>{/if}
    {/if}
    <input type="password" bind:value={elevenKey} placeholder="ElevenLabs API key" autocomplete="off" spellcheck="false" />
    <input type="password" bind:value={groqKey} placeholder="Groq API key (gsk_…)" autocomplete="off" spellcheck="false" />
    <input type="password" bind:value={anthropicKey} placeholder="Anthropic API key (sk-ant-…)" autocomplete="off" spellcheck="false" />
    <button class="primary" disabled={!elevenKey.trim() && !groqKey.trim() && !anthropicKey.trim()} onclick={saveKeys}>Save keys</button>
    {#if keyMsg}<p class="ok">{keyMsg}</p>{/if}
  </section>

  <section class="foot">
    <span class="label">Feed</span>
    <span class="status">{feed.relay.source || "—"} · {feed.relay.detail || (feed.relay.connected ? "connected" : "connecting")}</span>
  </section>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(3px);
    z-index: 10;
    animation: fade 0.25s;
  }
  .sheet {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(440px, 92vw);
    z-index: 11;
    background: var(--surface);
    border-left: 1px solid var(--hair-2);
    padding: 26px 26px 18px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 30px;
    animation: slide 0.35s var(--ease);
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes slide {
    from {
      transform: translateX(40px);
      opacity: 0;
    }
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    font-stretch: 115%;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .hint {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
    color: var(--text-3);
  }
  .delay {
    display: grid;
    grid-template-columns: 52px 52px 1fr 52px 52px;
    align-items: center;
    gap: 6px;
  }
  .delay button {
    height: 46px;
    border-radius: 12px;
    background: var(--surface-3);
    font-family: var(--f-num);
    font-size: 15px;
  }
  .delay button:active {
    background: var(--hair-2);
  }
  .value {
    text-align: center;
    font-size: 34px;
    font-weight: 600;
  }
  .value small {
    font-size: 15px;
    color: var(--text-3);
    margin-left: 2px;
  }
  input[type="range"] {
    width: 100%;
    accent-color: var(--text);
  }
  .primary {
    height: 46px;
    border-radius: 12px;
    background: var(--text);
    color: #000;
    font-weight: 700;
    font-size: 14px;
  }
  .primary:disabled {
    opacity: 0.3;
  }
  .ghost {
    height: 38px;
    border-radius: 12px;
    color: var(--text-2);
    font-size: 13px;
    box-shadow: inset 0 0 0 1px var(--hair-2);
  }
  input[type="password"],
  textarea {
    width: 100%;
    resize: none;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--hair-2);
    border-radius: 12px;
    padding: 12px;
    font-family: var(--f-num);
    font-size: 12px;
    user-select: text;
  }
  .tokstate {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pill {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--surface-3);
    color: var(--text-2);
  }
  .pill.good {
    color: var(--green);
    background: rgba(62, 224, 127, 0.1);
  }
  .pill.bad {
    color: var(--red);
    background: rgba(255, 59, 59, 0.1);
  }
  .err {
    color: var(--loss);
  }
  .ok {
    margin: 0;
    font-size: 13px;
    color: var(--text-2);
  }
  .foot {
    margin-top: auto;
    flex-direction: row;
    gap: 10px;
    align-items: baseline;
  }
  .status {
    font-size: 12px;
    color: var(--text-3);
  }
</style>
