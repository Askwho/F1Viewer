<script lang="ts">
  import type { Header } from "../lib/model.ts";
  import { clock } from "../lib/format.ts";

  let {
    h,
    delayMs,
    online,
    relayNote,
    replay,
    layout,
    onlayout,
    onsettings,
  }: {
    h: Header;
    delayMs: number;
    online: boolean;
    relayNote: string;
    replay: boolean;
    layout: "timing" | "map";
    onlayout: (l: "timing" | "map") => void;
    onsettings: () => void;
  } = $props();

  const partLabel = $derived(h.kind === "quali" && h.part ? `Q${h.part}` : "");
  const showLaps = $derived(h.kind === "race" && h.lap !== null);
  const waiting = $derived(!h.meeting);

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
</script>

<header class="hdr" data-tone={h.track.tone}>
  <button class="event" onclick={toggleFullscreen} title="Toggle full screen">
    <span class="mark" aria-hidden="true"></span>
    <span class="names">
      <span class="meeting">{waiting ? "Pit Wall" : h.meeting}</span>
      <span class="label">
        {#if waiting}Waiting for session{:else}{h.session}{#if partLabel}&nbsp;·&nbsp;{partLabel}{/if}{/if}
      </span>
    </span>
  </button>

  <div class="center">
    {#if showLaps}
      <span class="label">Lap</span>
      <span class="lap num">{h.lap}</span><span class="total num">/{h.totalLaps}</span>
    {:else if h.remainingMs !== null}
      <span class="clockbig num" class:paused={!h.clockRunning}>{clock(h.remainingMs)}</span>
    {/if}
    {#if h.track.tone !== "none"}
      <span class="status" data-tone={h.track.tone}>{h.track.label}</span>
    {/if}
    {#if h.status && h.status !== "Started"}
      <span class="label sess">{h.status === "Finished" || h.status === "Finalised" ? "Chequered flag" : h.status}</span>
    {/if}
  </div>

  <div class="right">
    <div class="wx">
      {#if h.weather.track !== undefined}
        <span><span class="label">Track</span><span class="num">{h.weather.track.toFixed(0)}°</span></span>
        <span><span class="label">Air</span><span class="num">{h.weather.air?.toFixed(0)}°</span></span>
        <span><span class="label">Hum</span><span class="num">{h.weather.humidity?.toFixed(0)}%</span></span>
        <span>
          <span class="label">Wind</span><span class="num">{h.weather.wind?.toFixed(1)}</span>
          <svg class="arrow" viewBox="0 0 10 10" style="transform: rotate({(h.weather.windDir ?? 0) + 180}deg)">
            <path d="M5 1 L8 8 L5 6.5 L2 8 Z" fill="currentColor" />
          </svg>
        </span>
        {#if h.weather.rain}<span class="rain">Rain</span>{/if}
      {/if}
    </div>
    <div class="seg" role="radiogroup" aria-label="Main view">
      <i class="thumb" class:map={layout === "map"} aria-hidden="true"></i>
      <button role="radio" aria-checked={layout === "timing"} title="Timing focus" onclick={() => onlayout("timing")}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M3 5h14M3 10h14M3 15h14" />
        </svg>
      </button>
      <button role="radio" aria-checked={layout === "map"} title="Map focus" onclick={() => onlayout("map")}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M6.5 3.5c-2.2 0-3.4 1.6-3 3.6l1.2 6.1c.4 2 2.3 3.3 4.3 3l6-.9c2-.3 3.2-2.3 2.6-4.2l-.5-1.5c-.4-1.3-1.7-2-3-1.7l-2.3.5c-1.1.2-1.9-.8-1.6-1.8l.2-.8c.4-1.3-.6-2.3-1.9-2.3z" />
        </svg>
      </button>
    </div>
    <button class="delay" class:on={delayMs > 0} onclick={onsettings} title={relayNote}>
      <span class="dot" class:off={!online}></span>
      {#if !online}Offline{:else if delayMs > 0}<span class="num">−{(delayMs / 1000).toFixed(0)}s</span>{:else if replay}Replay{:else}Live{/if}
    </button>
  </div>
</header>

<style>
  .hdr {
    position: relative;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    height: 58px;
    padding: 0 18px 0 14px;
    border-bottom: 1px solid var(--hair);
    transition: background 0.6s var(--ease);
  }
  /* Ambient track status: a lit edge you notice without looking. */
  .hdr::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    background: var(--status);
    box-shadow: 0 0 18px 1px var(--status);
    transition: background 0.4s, box-shadow 0.4s;
  }
  .hdr[data-tone="yellow"] {
    --status: var(--yellow);
  }
  .hdr[data-tone="sc"],
  .hdr[data-tone="vsc"] {
    --status: var(--amber);
    background: linear-gradient(180deg, rgba(255, 157, 28, 0.1), transparent);
  }
  .hdr[data-tone="red"] {
    --status: var(--red);
    background: linear-gradient(180deg, rgba(255, 59, 59, 0.14), transparent);
  }

  .event {
    display: flex;
    align-items: center;
    gap: 12px;
    justify-self: start;
    text-align: left;
  }
  .mark {
    width: 4px;
    height: 30px;
    border-radius: 2px;
    background: linear-gradient(180deg, #ff2a1f, #b30d06);
  }
  .names {
    display: flex;
    flex-direction: column;
    line-height: 1.15;
  }
  .meeting {
    font-size: 17px;
    font-weight: 700;
    font-stretch: 118%;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .center {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .lap {
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.03em;
  }
  .total {
    font-size: 17px;
    color: var(--text-3);
    margin-right: 10px;
  }
  .clockbig {
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.03em;
    margin-right: 10px;
  }
  .clockbig.paused {
    color: var(--text-2);
  }
  .status {
    align-self: center;
    font-size: 11px;
    font-weight: 700;
    font-stretch: 112%;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 4px 10px;
    border-radius: 999px;
    color: var(--text-2);
    background: var(--surface-2);
  }
  .status[data-tone="green"] {
    color: var(--green);
    background: rgba(62, 224, 127, 0.08);
  }
  .status[data-tone="yellow"] {
    color: #000;
    background: var(--yellow);
  }
  .status[data-tone="sc"],
  .status[data-tone="vsc"] {
    color: #000;
    background: var(--amber);
  }
  .status[data-tone="red"] {
    color: #fff;
    background: var(--red);
  }
  .sess {
    align-self: center;
    color: var(--text-2);
  }

  .right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 20px;
  }
  .wx {
    display: flex;
    gap: 14px;
    align-items: baseline;
    color: var(--text-2);
    font-size: 13.5px;
  }
  .wx > span {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
  }
  .wx .label {
    font-size: 9.5px;
  }
  .arrow {
    width: 10px;
    height: 10px;
    align-self: center;
    color: var(--text-3);
  }
  .rain {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--wet);
  }

  /* View switch: two icons on a pill, with a sliding thumb under the active one. */
  .seg {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    height: 34px;
    padding: 3px;
    border-radius: 999px;
    background: var(--surface-2);
  }
  .seg .thumb {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 3px;
    width: calc(50% - 3px);
    border-radius: 999px;
    background: var(--surface-3);
    box-shadow: inset 0 0 0 1px var(--hair-2);
    transition: transform 0.35s var(--ease);
  }
  .seg .thumb.map {
    transform: translateX(100%);
  }
  .seg button {
    position: relative;
    display: grid;
    place-items: center;
    width: 40px;
    color: var(--text-3);
    transition: color 0.25s;
  }
  .seg button[aria-checked="true"] {
    color: var(--text);
  }
  .seg svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .delay {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 14px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 12px;
    font-weight: 700;
    font-stretch: 112%;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-2);
  }
  .delay.on {
    color: var(--text);
  }
  .delay .num {
    font-size: 13px;
    letter-spacing: 0;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--red);
    box-shadow: 0 0 8px var(--red);
    animation: pulse 2s infinite;
  }
  .dot.off {
    background: var(--text-4);
    box-shadow: none;
    animation: none;
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }

  @media (max-width: 1100px) {
    .wx > span:nth-child(3),
    .wx > span:nth-child(4) {
      display: none;
    }
  }
</style>
