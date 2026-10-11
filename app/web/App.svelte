<script lang="ts">
  import { feed } from "./lib/feed.svelte.ts";
  import { header, rows, feedItems, flaggedSectors, type Row } from "./lib/model.ts";
  import Header from "./components/Header.svelte";
  import Tower from "./components/Tower.svelte";
  import TrackMap from "./components/TrackMap.svelte";
  import Feed from "./components/Feed.svelte";
  import Settings from "./components/Settings.svelte";

  feed.start();

  let now = $state(Date.now());
  setInterval(() => (now = Date.now()), 500);

  let settingsOpen = $state(false);
  let selected = $state<string | null>(null);

  // Which panel gets the big area: the timing tower or the track map. Remembered per device.
  type Layout = "timing" | "map";
  let layout = $state<Layout>(readLayout());
  function readLayout(): Layout {
    try {
      return localStorage.getItem("pitwall.layout") === "map" ? "map" : "timing";
    } catch {
      return "timing";
    }
  }
  function setLayout(next: Layout) {
    if (next === layout) return;
    try {
      localStorage.setItem("pitwall.layout", next);
    } catch {}
    const swap = () => (layout = next);
    const vt = (document as any).startViewTransition;
    if (vt && !matchMedia("(prefers-reduced-motion: reduce)").matches) vt.call(document, swap);
    else swap();
  }

  const H = $derived.by(() => (feed.version, now, header(feed.raw, feed.sessionNow())));
  const incidents = $derived.by(() => (feed.version, feed.incidents.evaluate()));
  const allRows = $derived.by(() => (feed.version, rows(feed.raw)));
  // In a race, cars out of it leave the tower and the map: retired or stopped per
  // F1, or parked on track with the engine off (F1 often keeps listing those for laps).
  const isOut = (r: Row) => H.kind === "race" && (r.retired || r.stopped || incidents.get(r.num)?.kind === "out");
  const R = $derived(allRows.filter((r) => !isOut(r)));
  const outRows = $derived(allRows.filter(isOut));
  const items = $derived.by(() => (feed.version, feedItems(feed.raw)));
  const flagged = $derived.by(() => (feed.version, flaggedSectors(feed.raw)));
  const byNum = $derived(new Map<string, Row>(R.map((r) => [r.num, r])));

  const circuitKey = $derived.by(() => (feed.version, feed.raw.SessionInfo?.Meeting?.Circuit?.Key ?? null));
  const year = $derived.by(() => (feed.version, Number(String(feed.raw.SessionInfo?.StartDate || "").slice(0, 4)) || new Date().getFullYear()));

  // Remember recent position changes so rows can show ▲2 / ▼1 for a moment.
  const lastPos = new Map<string, number>();
  const changes = new Map<string, { delta: number; at: number }>();
  const moves = $derived.by(() => {
    const t = Date.now();
    for (const r of R) {
      const prev = lastPos.get(r.num);
      // In qualifying, show improvements only: one driver going faster shuffles everyone below down by one.
      if (prev !== undefined && prev !== r.pos && r.pos < 99 && (H.kind === "race" || r.pos < prev)) {
        const carried = changes.get(r.num);
        const base = carried && t - carried.at < 12_000 ? carried.delta : 0;
        changes.set(r.num, { delta: base + (prev - r.pos), at: t });
      }
      lastPos.set(r.num, r.pos);
    }
    const out = new Map<string, number>();
    for (const [num, c] of changes) {
      if (now - c.at < 12_000 && c.delta) out.set(num, c.delta);
      else if (now - c.at >= 12_000) changes.delete(num);
    }
    return out;
  });

  function select(num: string) {
    selected = selected === num ? null : num;
  }

  // Keep the tablet awake while the dashboard is open (needs HTTPS or localhost).
  let wakeLock: any = null;
  async function keepAwake() {
    try {
      if (!wakeLock && document.visibilityState === "visible") {
        wakeLock = await (navigator as any).wakeLock?.request("screen");
        wakeLock?.addEventListener("release", () => (wakeLock = null));
      }
    } catch {}
  }
  document.addEventListener("visibilitychange", keepAwake);
  document.addEventListener("pointerdown", keepAwake, { once: true });
  keepAwake();
</script>

<div class="app" data-tone={H.track.tone}>
  <Header
    h={H}
    delayMs={feed.delayMs}
    online={feed.socketOpen && feed.relay.connected}
    relayNote={feed.relay.detail}
    replay={feed.relay.source === "replay"}
    {layout}
    onlayout={setLayout}
    onsettings={() => (settingsOpen = true)}
  />

  <main class:mapfocus={layout === "map"}>
    <section class="timing">
      {#if R.length}
        <Tower rows={R} kind={H.kind} part={H.part} {moves} {selected} onselect={select} compact={layout === "map"} {incidents} outs={outRows} />
      {:else}
        <div class="waiting">
          <p class="big">{feed.socketOpen ? "Waiting for timing" : "Connecting to relay"}</p>
          <p>{feed.relay.detail || "The dashboard comes alive when a session starts."}</p>
        </div>
      {/if}
    </section>

    <div class="mapbox">
      <TrackMap {circuitKey} {year} rows={R} {flagged} {selected} onselect={select} large={layout === "map"} {incidents} />
    </div>
    <div class="feedbox">
      <Feed {items} drivers={byNum} />
    </div>
  </main>

  {#if settingsOpen}
    <Settings onclose={() => (settingsOpen = false)} isRace={H.kind === "race"} />
  {/if}
</div>

<style>
  .app {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    height: 100dvh;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }
  /* Safety car / red flag: the whole frame takes on the status colour. */
  .app[data-tone="sc"],
  .app[data-tone="vsc"] {
    box-shadow: inset 0 0 0 2px rgba(255, 157, 28, 0.55);
  }
  .app[data-tone="red"] {
    box-shadow: inset 0 0 0 2px rgba(255, 59, 59, 0.65);
  }

  /* Timing focus: tower on the left, map over feed on the right.
     Map focus: map takes the big area with the feed beneath it, and a
     slim tower runs down the right edge. */
  main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) clamp(380px, 34vw, 760px);
    grid-template-rows: minmax(0, 52fr) minmax(0, 48fr);
    grid-template-areas:
      "timing map"
      "timing feed";
    min-height: 0;
  }
  main.mapfocus {
    grid-template-columns: minmax(0, 1fr) clamp(430px, 30vw, 560px);
    grid-template-rows: minmax(0, 1fr) clamp(170px, 26%, 260px);
    grid-template-areas:
      "map timing"
      "feed timing";
  }
  .timing {
    grid-area: timing;
    min-width: 0;
    min-height: 0;
    padding-top: 4px;
    view-transition-name: timing;
  }
  .mapbox {
    grid-area: map;
    padding: 18px 20px 10px;
    min-height: 0;
    min-width: 0;
    border-left: 1px solid var(--hair);
    view-transition-name: map;
  }
  .feedbox {
    grid-area: feed;
    min-height: 0;
    min-width: 0;
    border-top: 1px solid var(--hair);
    border-left: 1px solid var(--hair);
    view-transition-name: feed;
  }
  main.mapfocus .mapbox {
    padding: 22px 28px 12px;
    border-left: 0;
  }
  main.mapfocus .feedbox {
    border-left: 0;
  }
  main.mapfocus .timing {
    border-left: 1px solid var(--hair);
  }
  :global(::view-transition-group(*)) {
    animation-duration: 0.42s;
    animation-timing-function: cubic-bezier(0.2, 0.7, 0.2, 1);
  }
  .waiting {
    height: 100%;
    display: grid;
    place-content: center;
    text-align: center;
    color: var(--text-3);
    gap: 4px;
  }
  .waiting p {
    margin: 0;
    font-size: 14px;
  }
  .waiting .big {
    font-size: 22px;
    font-weight: 600;
    font-stretch: 112%;
    letter-spacing: 0.04em;
    color: var(--text-2);
  }

  @media (orientation: portrait) {
    main,
    main.mapfocus {
      grid-template-columns: 1fr 1fr;
      grid-template-rows: minmax(0, 64fr) minmax(0, 36fr);
      grid-template-areas:
        "timing timing"
        "map feed";
    }
    main.mapfocus {
      grid-template-areas:
        "map map"
        "timing feed";
    }
    .mapbox,
    main.mapfocus .mapbox {
      border-left: 0;
      border-top: 1px solid var(--hair);
    }
    main.mapfocus .timing {
      border-left: 0;
      border-top: 1px solid var(--hair);
    }
  }
</style>
