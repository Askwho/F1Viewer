<script lang="ts">
  import { flip } from "svelte/animate";
  import type { Row, SessionKind } from "../lib/model.ts";
  import type { Incident } from "../../shared/incidents.ts";
  import { gap, compoundLetter, segmentClass, lapTime } from "../lib/format.ts";

  let {
    rows,
    kind,
    part,
    moves,
    selected,
    onselect,
    compact = false,
    incidents = new Map(),
    outs = [],
  }: {
    rows: Row[];
    kind: SessionKind;
    part: number;
    moves: Map<string, number>;
    selected: string | null;
    onselect: (num: string) => void;
    compact?: boolean;
    incidents?: Map<string, Incident>;
    outs?: Row[];
  } = $props();

  const race = $derived(kind === "race");
  const firstDanger = $derived(rows.find((r) => r.danger)?.num);
  const cutActive = $derived(!race && rows.some((r) => r.cutDelta));

  // Reorder animations run on requestAnimationFrame, which stops while the page is hidden
  // (screen off, app switched). They then freeze rows mid-move; snap them home on return.
  let towerEl: HTMLDivElement;
  $effect(() => {
    const settle = () => {
      if (document.visibilityState !== "visible" || !towerEl) return;
      for (const a of towerEl.getAnimations({ subtree: true }))
        if (a instanceof Animation && !(a instanceof CSSAnimation) && !(a instanceof CSSTransition)) a.cancel();
    };
    document.addEventListener("visibilitychange", settle);
    return () => document.removeEventListener("visibilitychange", settle);
  });

  function closingText(c: number | null): string {
    if (c === null || Math.abs(c) < 0.05) return "";
    return `${c > 0 ? "▲" : "▼"}${Math.abs(c).toFixed(1)}`;
  }
  function closingShown(r: Row): boolean {
    const i = Number(r.interval.replace("+", ""));
    return race && r.closing !== null && Number.isFinite(i) && i < 3;
  }
</script>

<div class="tower" class:compact bind:this={towerEl} style="--n: {Math.max(rows.length, 20)}">
  <div class="row head">
    <div class="c-pos"></div>
    <div class="c-drv label">Driver</div>
    <div class="c-int label">{race ? "Interval" : cutActive ? "To cut" : "To ahead"}</div>
    <div class="c-gap label">{race ? "Leader" : "To P1"}</div>
    <div class="c-tyre label">Tyre</div>
    <div class="c-last label">Last lap</div>
    <div class="c-best label">{kind === "quali" && part ? `Q${part} best` : "Best"}</div>
    <div class="c-sec label">
      <span>S1</span><span>S2</span><span>S3</span>
    </div>
    <div class="c-pit label">{race ? "Pits" : "Lap"}</div>
  </div>

  <div class="body">
    {#each rows as r (r.num)}
      {@const out = r.retired || r.stopped || r.knockedOut}
      {@const move = moves.get(r.num) ?? 0}
      {@const inc = incidents.get(r.num)}
      <div
        class="row"
        class:sel={selected === r.num}
        class:out
        class:inpit={r.inPit}
        class:danger={r.danger}
        class:cut={r.num === firstDanger}
        class:push={r.lapState === "push"}
        class:incident={!!inc}
        class:halted={inc?.kind === "stopped"}
        style="--team: {r.color}"
        animate:flip={{ duration: 650, easing: (t) => 1 - Math.pow(1 - t, 3) }}
        onclick={() => onselect(r.num)}
        role="button"
        tabindex="0"
        onkeydown={(e) => e.key === "Enter" && onselect(r.num)}
      >
        <div class="c-pos num">
          {r.pos < 99 ? r.pos : ""}
          {#if move}
            <span class="move" class:up={move > 0}>{move > 0 ? "▲" : "▼"}{Math.abs(move)}</span>
          {/if}
        </div>

        <div class="c-drv">
          <i class="stripe"></i>
          <b>{r.tla}</b>
          {#if r.gridDelta}
            <span class="grid" class:up={r.gridDelta > 0}>{r.gridDelta > 0 ? "+" : "−"}{Math.abs(r.gridDelta)}</span>
          {/if}
        </div>

        <div class="c-int num" class:battle={r.battle}>
          {#if inc && !out}
            <span class="tag alert" class:halted={inc.kind === "stopped"}>{inc.kind === "slow" ? "Slow" : "Stopped"}</span>
          {:else if out}
            <span class="tag">{r.knockedOut ? "Out" : r.retired ? "Retired" : "Stopped"}</span>
          {:else if race && r.inPit}
            <span class="tag pit">In pit</span>
          {:else if race && r.pitOut}
            <span class="tag pit dim">Pit exit</span>
          {:else if race && r.pos === 1}
            <span class="leader">Leader</span>
          {:else if cutActive}
            <span class="v cutd" class:safe={r.cutSafe}>{r.cutDelta}</span>
          {:else}
            <span class="v">{gap(r.interval)}</span>
            {#if closingShown(r)}
              <span class="closing" class:gaining={(r.closing ?? 0) > 0}>{closingText(r.closing)}</span>
            {/if}
          {/if}
        </div>

        <div class="c-gap num">{out ? "" : gap(r.gap)}</div>

        <div class="c-tyre">
          {#if r.compound}
            <span class="tyre {r.compound.toLowerCase()}" class:used={!r.tyreNew}>{compoundLetter(r.compound)}</span>
            <span class="age num">{r.tyreAge ?? ""}</span>
          {/if}
        </div>

        <div class="c-last num">
          {#if r.projection}
            <span class="proj {r.projection.mark}" title="Projected from completed sectors plus personal-best sectors">
              <span class="approx">≈</span>{lapTime(r.projection.time)}
            </span>
          {:else}
            {#key r.lastLap}
              <span class="flash {r.lastMark}" class:slow={r.lastSlow}>{r.lastLap}</span>
            {/key}
          {/if}
        </div>

        <div class="c-best num {r.bestMark}">
          {#key r.bestLap}
            <span class="flash {race ? '' : r.bestMark || 'pb'}">{r.bestLap}</span>
          {/key}
        </div>

        <div class="c-sec">
          {#each r.sectors as s, i (i)}
            <div class="sec">
              {#key s.value}
                <span class="num flash {s.mark}" class:stale={s.stale}>{s.value}</span>
              {/key}
              <span class="segs">
                {#each s.segments as g, j (j)}
                  <i class={segmentClass(g)}></i>
                {/each}
              </span>
            </div>
          {/each}
        </div>

        <div class="c-pit num">
          {#if race}
            {#if r.pitStops}{r.pitStops}{/if}
          {:else if r.lapState === "pit"}
            <span class="tag pit small">Pit</span>
          {:else if r.lapState === "out"}
            <span class="tag pit dim small">Out</span>
          {:else if r.projection}
            <span class="ppos {r.projection.mark}" title="Projected position">P{r.projection.pos}</span>
          {:else if r.lapState === "push"}
            <span class="tag push small">Push</span>
          {:else}
            <span class="lapn">{r.laps || ""}</span>
          {/if}
        </div>
      </div>
    {/each}
  </div>
  {#if outs.length}
    <div class="outs">
      <span class="label">Out</span>
      {#each outs as r (r.num)}
        <span class="gone" style="--team: {r.color}"><i class="stripe"></i>{r.tla}</span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .tower {
    --cols: 44px 104px 112px 92px 70px 100px 96px minmax(250px, 400px) 44px;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    padding: 0 8px 6px 6px;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-rows: repeat(var(--n), minmax(0, 1fr));
  }
  .row {
    display: grid;
    grid-template-columns: var(--cols);
    align-items: center;
    column-gap: 4px;
    position: relative;
    border-radius: 6px;
    font-size: 15px;
    cursor: pointer;
  }
  .row:not(.head)::after {
    content: "";
    position: absolute;
    left: 44px;
    right: 0;
    bottom: 0;
    height: 1px;
    background: var(--hair);
  }
  .row.head {
    height: 34px;
    flex: none;
    cursor: default;
  }
  .row.head .label {
    font-size: 9.5px;
    color: var(--text-3);
  }
  .row.sel {
    background: var(--surface-3);
  }
  .row.sel::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 6px;
    box-shadow: inset 0 0 0 1px var(--hair-2);
  }
  .row.out {
    opacity: 0.38;
  }
  .row.inpit .c-drv b {
    color: var(--text-2);
  }
  .row.push {
    background: linear-gradient(90deg, rgba(255, 255, 255, 0.055), transparent 75%);
  }
  .row.push .stripe {
    box-shadow: 0 0 14px 0 var(--team);
  }
  .row.danger {
    background: linear-gradient(90deg, rgba(255, 59, 59, 0.07), transparent 70%);
  }
  .row.cut {
    box-shadow: inset 0 1px 0 rgba(255, 59, 59, 0.55);
  }

  /* Position */
  .c-pos {
    position: relative;
    text-align: right;
    padding-right: 10px;
    font-size: 15px;
    color: var(--text-2);
  }
  .move {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    font-size: 8.5px;
    color: var(--loss);
    animation: fadeout 12s forwards;
  }
  .move.up {
    color: var(--gain);
  }
  @keyframes fadeout {
    0%,
    70% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }

  /* Driver */
  .c-drv {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .stripe {
    width: 4px;
    height: 20px;
    border-radius: 2px;
    background: var(--team);
    box-shadow: 0 0 10px -2px var(--team);
  }
  .c-drv b {
    font-size: 17px;
    font-weight: 650;
    font-stretch: 108%;
    letter-spacing: 0.05em;
  }
  .grid {
    font-family: var(--f-num);
    font-size: 10px;
    color: var(--loss);
    opacity: 0.8;
  }
  .grid.up {
    color: var(--gain);
  }

  /* Gaps */
  .c-int {
    display: flex;
    align-items: baseline;
    gap: 6px;
    white-space: nowrap;
  }
  .c-int.battle .v {
    color: var(--battle);
  }
  .c-int.battle::before {
    content: "";
    width: 3px;
    height: 14px;
    align-self: center;
    margin-left: -9px;
    margin-right: 0;
    border-radius: 2px;
    background: var(--battle);
  }
  .closing {
    font-size: 10px;
    color: var(--text-3);
  }
  .closing.gaining {
    color: var(--battle);
  }
  .leader {
    font-family: var(--f-ui);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .c-gap {
    color: var(--text-2);
    font-size: 14px;
  }
  .tag {
    font-family: var(--f-ui);
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-2);
  }
  /* Incidents: amber for a car crawling, red for one stopped on track. */
  .tag.alert {
    color: #160c00;
    background: var(--amber);
    padding: 2px 7px;
    border-radius: 4px;
    animation: alert 1.2s ease-in-out infinite;
  }
  .tag.alert.halted {
    color: #fff;
    background: var(--red);
  }
  @keyframes alert {
    50% {
      opacity: 0.55;
    }
  }
  .row.incident {
    background: linear-gradient(90deg, rgba(255, 157, 28, 0.16), transparent 80%);
  }
  .row.incident.halted {
    background: linear-gradient(90deg, rgba(255, 59, 59, 0.18), transparent 80%);
  }
  .row.incident .stripe {
    box-shadow: 0 0 14px 1px var(--team);
  }

  .outs {
    flex: none;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 14px;
    padding: 8px 0 2px 44px;
    border-top: 1px solid var(--hair-2);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--text-3);
  }
  .outs .label {
    font-size: 9.5px;
    margin-right: 2px;
  }
  .gone {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .gone .stripe {
    height: 14px;
    opacity: 0.5;
  }

  .tag.pit {
    color: #001114;
    background: var(--pit);
    padding: 2px 7px;
    border-radius: 4px;
  }
  .tag.small {
    font-size: 9.5px;
    padding: 2px 5px;
    letter-spacing: 0.08em;
  }
  .tag.pit.dim {
    color: var(--pit);
    background: rgba(82, 211, 230, 0.12);
  }

  /* Tyre */
  .c-tyre {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .tyre {
    --c: var(--text-3);
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2.5px solid var(--c);
    color: var(--c);
    font-size: 11px;
    font-weight: 800;
    line-height: 1;
  }
  .tyre.used {
    border-style: solid;
    opacity: 0.78;
  }
  .tyre.soft {
    --c: var(--soft);
  }
  .tyre.medium {
    --c: var(--medium);
  }
  .tyre.hard {
    --c: var(--hard);
  }
  .tyre.intermediate {
    --c: var(--inter);
  }
  .tyre.wet {
    --c: var(--wet);
  }
  .age {
    font-size: 13px;
    color: var(--text-2);
  }

  /* Lap times */
  .c-last .slow {
    color: var(--text);
  }
  .c-best {
    color: var(--text-2);
    font-size: 14px;
  }
  .c-best.ob {
    color: var(--purple);
  }
  .flash {
    border-radius: 4px;
    padding: 1px 4px;
    margin-left: -4px;
  }
  .flash.ob {
    animation: flash-ob 2.4s var(--ease);
  }
  .flash.pb {
    animation: flash-pb 2s var(--ease);
  }
  @keyframes flash-ob {
    0% {
      background: rgba(196, 107, 255, 0.45);
    }
    100% {
      background: rgba(196, 107, 255, 0);
    }
  }
  @keyframes flash-pb {
    0% {
      background: rgba(62, 224, 127, 0.3);
    }
    100% {
      background: rgba(62, 224, 127, 0);
    }
  }

  /* Sectors */
  .c-sec {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    column-gap: 12px;
    padding-left: 8px;
  }
  .row.head .c-sec span {
    padding-left: 0;
  }
  .sec {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .sec .num {
    font-size: 13px;
    line-height: 1.15;
    color: var(--text);
  }
  .sec .num.stale {
    color: var(--text-4);
  }
  .sec .num.ob {
    color: var(--purple);
  }
  .sec .num.pb {
    color: var(--green);
  }
  .segs {
    display: flex;
    gap: 2px;
    height: 3px;
  }
  .segs i {
    flex: 1;
    border-radius: 1px;
    background: var(--text-4);
    opacity: 0.55;
  }
  .segs i.y {
    background: var(--yellow);
    opacity: 0.85;
  }
  .segs i.pb {
    background: var(--green);
    opacity: 1;
  }
  .segs i.ob {
    background: var(--purple);
    opacity: 1;
  }
  .segs i.pit {
    background: var(--pit);
    opacity: 0.7;
  }
  .segs i.dim {
    background: var(--text-3);
  }

  .cutd {
    color: var(--loss);
  }
  .cutd.safe {
    color: var(--text-3);
  }
  .proj {
    display: inline-flex;
    align-items: baseline;
    gap: 2px;
    color: var(--yellow);
    animation: breathe 1.6s ease-in-out infinite;
  }
  .proj.pb {
    color: var(--green);
  }
  .proj.ob {
    color: var(--purple);
  }
  .approx {
    font-size: 11px;
    opacity: 0.7;
  }
  .ppos {
    display: inline-block;
    min-width: 30px;
    font-family: var(--f-ui);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.02em;
    padding: 2px 5px;
    border-radius: 4px;
    color: #000;
    background: var(--yellow);
    animation: breathe 1.6s ease-in-out infinite;
  }
  .ppos.pb {
    background: var(--green);
  }
  .ppos.ob {
    background: var(--purple);
  }
  @keyframes breathe {
    50% {
      opacity: 0.72;
    }
  }
  .tag.push {
    color: #000;
    background: var(--text);
  }
  .lapn {
    color: var(--text-3);
  }
  .c-pit {
    text-align: center;
    color: var(--text-2);
    font-size: 13px;
  }

  /* Map focus: a slim leaderboard beside the map. Position, driver, gap, tyre, last lap. */
  .tower.compact {
    --cols: 40px 92px minmax(0, 1fr) 62px 92px;
    padding: 0 10px 6px 6px;
  }
  .tower.compact :is(.c-gap, .c-best, .c-sec, .c-pit) {
    display: none;
  }

  @media (max-width: 1350px) {
    .tower:not(.compact) {
      --cols: 40px 96px 104px 84px 64px 92px 88px minmax(200px, 1fr) 36px;
    }
  }
</style>
