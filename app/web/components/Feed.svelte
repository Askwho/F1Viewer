<script lang="ts">
  import type { FeedItem, Row } from "../lib/model.ts";
  import { localTime } from "../lib/format.ts";

  let { items, drivers }: { items: FeedItem[]; drivers: Map<string, Row> } = $props();

  type Filter = "all" | "rc" | "radio";
  let filter = $state<Filter>("all");
  const shown = $derived(
    items.filter((i) => (filter === "all" ? !(i.kind === "rc" && i.flag === "BLUE") : i.kind === filter)).slice(0, 80),
  );

  // One shared player: starting a clip stops the previous one.
  const audio = typeof Audio !== "undefined" ? new Audio() : null;
  let playing = $state<string | null>(null);
  let progress = $state(0);
  audio?.addEventListener("timeupdate", () => (progress = audio.duration ? audio.currentTime / audio.duration : 0));
  audio?.addEventListener("ended", () => (playing = null));

  function play(item: FeedItem) {
    if (!audio || !item.audio) return;
    if (playing === item.id) {
      audio.pause();
      playing = null;
      return;
    }
    audio.src = item.audio;
    audio.play().catch(() => (playing = null));
    playing = item.id;
    progress = 0;
  }

  function flagClass(f?: string): string {
    if (!f) return "";
    return f.toLowerCase().replace(/\s+/g, "-");
  }

  function sentence(text: string): string {
    // Race control shouts; lower-case it but keep the parts that should stay loud.
    const lower = text.toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (m) => m.toUpperCase());
    return lower
      .replace(/\b(car \d+) \(([a-z]{3})\)/gi, (_m, car, tla) => `${car[0].toUpperCase()}${car.slice(1)} (${tla.toUpperCase()})`)
      .replace(/\b(drs|fia|vsc|sc)\b/gi, (m) => m.toUpperCase())
      .replace(/\bturn (\d+)/gi, "Turn $1")
      .replace(/\b(t\d+)\b/gi, (m) => m.toUpperCase());
  }
</script>

<section class="feed">
  <div class="tabs">
    <button class:on={filter === "all"} onclick={() => (filter = "all")}>All</button>
    <button class:on={filter === "rc"} onclick={() => (filter = "rc")}>Race control</button>
    <button class:on={filter === "radio"} onclick={() => (filter = "radio")}>Radio</button>
  </div>

  <ol class="list">
    {#each shown as item (item.id)}
      {@const d = item.num ? drivers.get(item.num) : undefined}
      <li class="item {item.kind}" class:important={item.important}>
        <div class="meta">
          <span class="num">{localTime(item.utc)}</span>
          {#if item.lap}<span class="lap num">L{item.lap}</span>{/if}
        </div>
        {#if item.kind === "radio"}
          <button class="clip" class:playing={playing === item.id} onclick={() => play(item)} style="--team: {d?.color ?? '#666'}">
            <span class="play" aria-hidden="true">
              {#if playing === item.id}
                <svg viewBox="0 0 10 10"><rect x="2" y="2" width="2" height="6" /><rect x="6" y="2" width="2" height="6" /></svg>
              {:else}
                <svg viewBox="0 0 10 10"><path d="M3 2 L8 5 L3 8 Z" /></svg>
              {/if}
            </span>
            <i class="stripe"></i>
            <b>{d?.tla ?? item.num}</b>
            <span class="who">{d?.name ?? ""}</span>
            {#if playing === item.id}<span class="bar" style="--p: {progress}"></span>{/if}
          </button>
          {@const t = item.transcript}
          {#if t?.lines?.length}
            <div class="tx" style="--team: {d?.color ?? '#666'}">
              {#each t.lines as line, i (i)}
                {@const sameSpeaker = i > 0 && t.lines[i - 1].speaker === line.speaker}
                <p class="ln {line.speaker}" class:cont={sameSpeaker}>
                  <span class="spk">{#if !sameSpeaker && line.speaker !== "unclear"}{line.speaker === "driver" ? (d?.tla ?? "DRV") : "Eng"}{/if}</span>
                  <span class="said">{line.text}</span>
                </p>
              {/each}
            </div>
          {:else if t?.skipped}
            <p class="tx pending">Short clip · tap play to listen</p>
          {:else if t?.status === "done"}
            <p class="tx pending">No clear speech · tap play to listen</p>
          {:else if t?.status === "failed"}
            <p class="tx pending">Transcript unavailable · tap play to listen</p>
          {/if}
        {:else}
          <div class="msg">
            {#if item.flag}<span class="flag {flagClass(item.flag)}" title={item.flag}></span>{/if}
            <span class="text">{sentence(item.text ?? "")}</span>
          </div>
        {/if}
      </li>
    {:else}
      <li class="empty">Nothing yet</li>
    {/each}
  </ol>
</section>

<style>
  .feed {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }
  .tabs {
    display: flex;
    gap: 4px;
    padding: 10px 14px 8px;
  }
  .tabs button {
    font-size: 10.5px;
    font-weight: 700;
    font-stretch: 112%;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-3);
    padding: 6px 11px;
    border-radius: 999px;
  }
  .tabs button.on {
    color: var(--text);
    background: var(--surface-3);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0 14px 14px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    mask-image: linear-gradient(180deg, #000 calc(100% - 32px), transparent);
  }
  .item {
    display: grid;
    grid-template-columns: 62px 1fr;
    gap: 8px;
    padding: 9px 0;
    border-bottom: 1px solid var(--hair);
    animation: enter 0.5s var(--ease);
  }
  @keyframes enter {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: 11.5px;
    color: var(--text-3);
    padding-top: 1px;
  }
  .lap {
    font-size: 10.5px;
    color: var(--text-4);
  }
  .msg {
    display: flex;
    gap: 9px;
    align-items: flex-start;
    font-size: 13.5px;
    line-height: 1.38;
    color: var(--text-2);
  }
  .important .msg {
    color: var(--text);
    font-weight: 550;
  }
  .flag {
    flex: none;
    width: 14px;
    height: 10px;
    margin-top: 4px;
    border-radius: 2px;
    background: var(--text-4);
  }
  .flag.green,
  .flag.clear {
    background: var(--green);
  }
  /* Detected from telemetry rather than announced: a diamond instead of a flag. */
  .flag[class*="detected"] {
    width: 9px;
    height: 9px;
    margin: 5px 3px 0 2px;
    border-radius: 1px;
    transform: rotate(45deg);
    background: var(--amber);
  }
  .flag.detected-stopped,
  .flag.detected-out {
    background: var(--red);
  }
  .flag.yellow {
    background: var(--yellow);
  }
  .flag.double-yellow {
    background: linear-gradient(180deg, var(--yellow) 0 42%, transparent 42% 58%, var(--yellow) 58%);
  }
  .flag.red {
    background: var(--red);
  }
  .flag.blue {
    background: var(--wet);
  }
  .flag.black-and-white {
    background: linear-gradient(135deg, #fff 50%, #000 50%);
    box-shadow: 0 0 0 1px #666;
  }
  .flag.black {
    background: #000;
    box-shadow: 0 0 0 1px #666;
  }
  .flag.chequered {
    background: repeating-conic-gradient(#fff 0 25%, #000 0 50%) 0 0 / 5px 5px;
  }

  .item.radio {
    row-gap: 4px;
  }
  .item.radio .tx {
    grid-column: 2;
  }
  .tx {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding-left: 35px;
  }
  .tx.pending {
    font-size: 12px;
    color: var(--text-4);
    font-style: italic;
  }
  .ln {
    margin: 0;
    display: grid;
    grid-template-columns: 34px 1fr;
    gap: 6px;
    font-size: 13.5px;
    line-height: 1.38;
  }
  .ln.cont {
    margin-top: -2px;
  }
  .spk {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding-top: 3px;
    color: var(--text-3);
  }
  .ln.driver .spk {
    color: var(--team);
  }
  .ln.driver .said {
    color: var(--text);
  }
  .ln.engineer .said,
  .ln.unclear .said {
    color: var(--text-2);
  }
  .important .ln.driver .said {
    font-weight: 550;
  }
  .clip {
    position: relative;
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    text-align: left;
    padding: 2px 0;
    font-size: 13.5px;
    overflow: hidden;
  }
  .play {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--surface-3);
    flex: none;
  }
  .play svg {
    width: 10px;
    height: 10px;
    fill: var(--text);
  }
  .playing .play {
    background: var(--text);
  }
  .playing .play svg {
    fill: #000;
  }
  .stripe {
    width: 3px;
    height: 14px;
    border-radius: 2px;
    background: var(--team);
  }
  .clip b {
    font-weight: 650;
    letter-spacing: 0.05em;
  }
  .who {
    color: var(--text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bar {
    position: absolute;
    left: 35px;
    right: 0;
    bottom: -4px;
    height: 2px;
    background: linear-gradient(90deg, var(--team) calc(var(--p) * 100%), var(--hair-2) 0);
  }
  .empty {
    padding: 20px 0;
    color: var(--text-4);
    font-size: 13px;
  }
</style>
