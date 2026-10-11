<script lang="ts">
  import { feed } from "../lib/feed.svelte.ts";
  import type { Row } from "../lib/model.ts";
  import type { Incident } from "../../shared/incidents.ts";

  let {
    circuitKey,
    year,
    rows,
    flagged,
    selected,
    onselect,
    large = false,
    incidents = new Map(),
  }: {
    circuitKey: number | null;
    year: number;
    rows: Row[];
    flagged: Map<number, "yellow" | "double">;
    selected: string | null;
    onselect: (num: string) => void;
    large?: boolean;
    incidents?: Map<string, Incident>;
  } = $props();

  // Labels are sized in map units, so they grow with the map; rein them in when it fills the screen.
  const k = $derived(large ? 0.72 : 1);

  interface Circuit {
    x: number[];
    y: number[];
    rotation: number;
    corners: { n: number; l?: string; x: number; y: number; a: number }[];
    sectors: { n: number; x: number; y: number }[];
    traced?: boolean; // outline drawn from car positions; start point is arbitrary
  }

  let circuit = $state<Circuit | null>(null);
  let failed = $state(false);
  let hasCars = $state(false);

  // New venues have no published outline; the relay traces one from car
  // positions after a lap, so keep asking until it appears.
  $effect(() => {
    if (!circuitKey) return;
    const url = `/api/circuit/${circuitKey}/${year}`;
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    circuit = null;
    failed = false;
    const load = () =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((c) => alive && (circuit = c))
        .catch(() => {
          if (!alive) return;
          failed = true;
          timer = setTimeout(load, 15_000);
        });
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  });

  // Rotate so the map matches the orientation used on TV graphics.
  // SVG's y axis points down, so the feed's y is mirrored.
  const geo = $derived.by(() => {
    if (!circuit) return null;
    const a = ((circuit.rotation + 0) * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const tf = (x: number, y: number): [number, number] => [x * cos - y * sin, -(x * sin + y * cos)];
    const pts = circuit.x.map((x, i) => tf(x, circuit!.y[i]));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const u = Math.max(maxX - minX, maxY - minY) / 100;
    const pad = u * 7;
    const path = "M" + pts.map((p) => `${p[0].toFixed(0)} ${p[1].toFixed(0)}`).join("L") + "Z";

    // Marshal sector n spans from its start point to the next sector's start.
    const nearest = (x: number, y: number) => {
      const [tx, ty] = tf(x, y);
      let best = 0;
      let bd = Infinity;
      pts.forEach((p, i) => {
        const d = (p[0] - tx) ** 2 + (p[1] - ty) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      return best;
    };
    const starts = circuit.sectors.map((s) => ({ n: s.n, i: nearest(s.x, s.y) })).sort((a, b) => a.i - b.i);
    const sectorPaths = new Map<number, string>();
    starts.forEach((s, k) => {
      const end = k + 1 < starts.length ? starts[k + 1].i : pts.length + starts[0].i;
      const seg: [number, number][] = [];
      for (let i = s.i; i <= end; i++) seg.push(pts[i % pts.length]);
      sectorPaths.set(s.n, "M" + seg.map((p) => `${p[0].toFixed(0)} ${p[1].toFixed(0)}`).join("L"));
    });

    const corners = circuit.corners.map((c) => {
      const [x, y] = tf(c.x, c.y);
      // Place the number just off the racing line, on the outside of the corner.
      const ang = ((c.a + circuit!.rotation) * Math.PI) / 180;
      return { label: `${c.n}${c.l || ""}`, x: x + Math.cos(ang) * u * 3.4, y: y - Math.sin(ang) * u * 3.4 };
    });

    const [sx, sy] = pts[0];
    const [nx, ny] = pts[3] || pts[1];
    const startAngle = (Math.atan2(ny - sy, nx - sx) * 180) / Math.PI;

    return {
      tf,
      u,
      path,
      sectorPaths,
      corners,
      start: { x: sx, y: sy, angle: startAngle },
      view: `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`,
    };
  });

  const cars = $derived([...rows].reverse()); // leader drawn last, on top
  // In qualifying, the cars on push laps are the story: let the rest recede.
  const anyPush = $derived(rows.some((r) => r.lapState === "push"));
  const carEls = new Map<string, SVGGElement>();

  function register(el: SVGGElement, num: string) {
    carEls.set(num, el);
    return { destroy: () => carEls.delete(num) };
  }

  // Animation loop: interpolate each car between its two bracketing samples.
  $effect(() => {
    if (!geo) return;
    const { tf } = geo;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const P = feed.sessionNow() - feed.positionLag;
      let any = false;
      for (const [num, el] of carEls) {
        const arr = feed.samples.get(num);
        if (!arr || !arr.length) {
          el.style.display = "none";
          continue;
        }
        let b = arr.length;
        while (b > 0 && arr[b - 1].ts > P) b--;
        let x: number, y: number, off: boolean;
        if (b === 0) ({ x, y, off } = arr[0]);
        else if (b === arr.length) ({ x, y, off } = arr[arr.length - 1]);
        else {
          const p = arr[b - 1];
          const q = arr[b];
          const f = (P - p.ts) / (q.ts - p.ts);
          x = p.x + (q.x - p.x) * f;
          y = p.y + (q.y - p.y) * f;
          off = q.off;
        }
        if (x === 0 && y === 0) {
          el.style.display = "none";
          continue;
        }
        any = true;
        const [tx, ty] = tf(x, y);
        el.style.display = "";
        el.setAttribute("transform", `translate(${tx.toFixed(1)} ${ty.toFixed(1)})`);
        el.classList.toggle("off", off);
      }
      if (any !== hasCars) hasCars = any;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  });
</script>

<div class="map">
  {#if geo}
    <svg viewBox={geo.view} preserveAspectRatio="xMidYMid meet" style="--u: {geo.u}">
      <path class="track-edge" d={geo.path} stroke-width={geo.u * 2.6} />
      <path class="track" d={geo.path} stroke-width={geo.u * 1.5} />
      {#each [...flagged] as [n, kind] (n)}
        {#if geo.sectorPaths.get(n)}
          <path class="flag {kind}" d={geo.sectorPaths.get(n)} stroke-width={geo.u * 1.7} />
        {/if}
      {/each}
      {#if !circuit?.traced}<line
        class="finish"
        x1={-geo.u * 2}
        x2={geo.u * 2}
        y1="0"
        y2="0"
        stroke-width={geo.u * 0.7}
        transform="translate({geo.start.x} {geo.start.y}) rotate({geo.start.angle + 90})"
      />{/if}
      {#each geo.corners as c (c.label)}
        <text class="corner" x={c.x} y={c.y} font-size={geo.u * 2.5 * k}>{c.label}</text>
      {/each}

      {#each cars as r (r.num)}
        {@const inc = incidents.get(r.num)}
        <g
          class="car"
          class:sel={selected === r.num}
          class:dim={(!!selected && selected !== r.num) || (!selected && anyPush && r.lapState !== "push")}
          class:push={r.lapState === "push"}
          class:pit={r.inPit}
          class:incident={!!inc}
          class:halted={inc?.kind === "stopped"}
          style="--team: {r.color}; display: none"
          use:register={r.num}
          onclick={() => onselect(r.num)}
          role="button"
          tabindex="-1"
          onkeydown={() => {}}
        >
          {#if selected === r.num}<circle class="halo" r={geo.u * 3.2} />{/if}
          {#if inc}
            <circle class="ping" r={geo.u * 2.4} stroke-width={geo.u * 0.5} />
            <circle class="ping late" r={geo.u * 2.4} stroke-width={geo.u * 0.5} />
          {/if}
          <circle r={geo.u * 1.25} stroke-width={geo.u * 0.45} />
          {#if !r.inPit || selected === r.num}
            <text x={geo.u * (1.3 + 0.7 * k)} y={geo.u * 0.85 * k} font-size={geo.u * 2.6 * k} stroke-width={geo.u * 0.7 * k}>{r.tla}</text>
          {/if}
        </g>
      {/each}
    </svg>
    {#if !hasCars}
      <p class="note">Car positions need an F1 TV token: open settings to add one</p>
    {/if}
  {:else if failed}
    <p class="note mid">Tracing this circuit from car positions: the map appears after a lap</p>
  {/if}
</div>

<style>
  .map {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  svg {
    width: 100%;
    height: 100%;
    display: block;
    overflow: visible;
  }
  path {
    fill: none;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .track-edge {
    stroke: #16161b;
  }
  .track {
    stroke: #33333d;
  }
  .flag {
    stroke: var(--yellow);
    opacity: 0.9;
    filter: drop-shadow(0 0 calc(var(--u) * 1.4px) rgba(255, 212, 61, 0.6));
  }
  .flag.double {
    stroke: #ffb800;
    animation: blink 1s steps(2, start) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.45;
    }
  }
  .finish {
    stroke: var(--text);
  }
  .corner {
    fill: var(--text-4);
    font-family: var(--f-num);
    text-anchor: middle;
    dominant-baseline: central;
  }
  .car {
    cursor: pointer;
    transition: opacity 0.3s;
  }
  .car circle {
    fill: var(--team);
    stroke: #000;
  }
  .car .halo {
    fill: none;
    stroke: var(--text);
    stroke-width: calc(var(--u) * 0.35);
    opacity: 0.8;
  }
  .car text {
    fill: var(--text);
    font-family: var(--f-ui);
    font-weight: 700;
    letter-spacing: 0.04em;
    paint-order: stroke;
    stroke: #000;
    stroke-linejoin: round;
  }
  .car.dim:not(.incident) {
    opacity: 0.4;
  }
  /* A car in trouble sends out rings, amber when crawling and red when stopped. */
  .car .ping {
    fill: none;
    stroke: var(--amber);
    transform-box: fill-box;
    transform-origin: center;
    animation: ping 1.6s cubic-bezier(0.2, 0.7, 0.2, 1) infinite;
  }
  .car .ping.late {
    animation-delay: 0.8s;
  }
  .car.halted .ping {
    stroke: var(--red);
  }
  @keyframes ping {
    from {
      transform: scale(0.5);
      opacity: 1;
    }
    to {
      transform: scale(2.6);
      opacity: 0;
    }
  }
  .car.incident text {
    fill: var(--amber);
  }
  .car.incident.halted text {
    fill: var(--red);
  }
  .car.push circle {
    stroke: var(--text);
  }
  .car.pit text,
  .car:global(.off) text {
    fill: var(--text-3);
  }
  .note.mid {
    top: 50%;
    bottom: auto;
  }
  .note {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 6px;
    margin: 0;
    text-align: center;
    font-size: 11px;
    letter-spacing: 0.04em;
    color: var(--text-3);
  }
</style>
