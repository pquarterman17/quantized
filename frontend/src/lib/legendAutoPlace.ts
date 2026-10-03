// The "auto" legend position (plot audit round 2) — loaded on demand by
// `uplotFrameVars` after each draw of the main plot.
//
// A fixed corner legend covered data: ten SIMS profiles start in the top
// right, and a 32-series spectrum fills most of it. `auto` instead:
//
//   - up to eight shown series: the box sits inside the plot frame, in the
//     corner whose box-sized patch covers the fewest drawn points (the
//     matplotlib "best" idea; the export uses "best" itself);
//   - more than eight: a column OUTSIDE the frame's right edge, with the plot
//     narrowed to make room (the export uses "outside right").
//
// The corner is written to the stage as `data-lc` and the column's measured
// width as `--qz-out-w`; shell.css does the placing, so React never
// re-renders for either. The tool readout's frame corner rides along as
// `data-rc` (`pickReadoutCorner`).

import type uPlot from "uplot";

export type Corner = "ne" | "nw" | "se" | "sw";

/** Preference order on a tie: top right first, as the old fixed default. */
const CORNERS: readonly Corner[] = ["ne", "nw", "se", "sw"];
/** The gap (px) shell.css leaves between an auto legend and the frame. */
const INSET = 8;
/** Drawn points examined per plot at most (spread across its series). */
const BUDGET = 6000;
/** A frame narrower than this (CSS px) gets `data-narrow-frame` on the stage,
 *  and shell.css drops the legend's ▲▼ buttons (its row menu keeps them). */
export const NARROW_FRAME = 320;

/** Drawn points (CSS px inside the frame) of every shown series, sampled to
 *  `BUDGET`, with long segments filled in so a sparse line crossing a corner
 *  still counts there. */
export function drawnPoints(u: uPlot): [number, number][] {
  const shown = u.series.slice(1).filter((s) => s.show !== false).length || 1;
  const xs = u.data[0] as ArrayLike<number | null>;
  const stride = Math.max(1, Math.ceil((xs.length * shown) / BUDGET));
  const pts: [number, number][] = [];
  u.series.forEach((s, k) => {
    if (k === 0 || s.show === false) return;
    const ys = u.data[k] as ArrayLike<number | null>;
    let prev: [number, number] | null = null;
    for (let i = 0; i < xs.length; i += stride) {
      const x = xs[i];
      const y = ys[i];
      if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) {
        prev = null;
        continue;
      }
      const p: [number, number] = [u.valToPos(x, "x"), u.valToPos(y, s.scale ?? "y")];
      if (prev) {
        const steps = Math.min(8, Math.floor(Math.hypot(p[0] - prev[0], p[1] - prev[1]) / 12));
        for (let j = 1; j <= steps; j++) {
          const t = j / (steps + 1);
          pts.push([prev[0] + (p[0] - prev[0]) * t, prev[1] + (p[1] - prev[1]) * t]);
        }
      }
      pts.push(p);
      prev = p;
    }
  });
  return pts;
}

/** Points under a `w`×`h` box in each corner of a `W`×`H` frame. */
export function cornerCounts(
  pts: readonly [number, number][],
  W: number,
  H: number,
  w: number,
  h: number,
): Record<Corner, number> {
  const c: Record<Corner, number> = { ne: 0, nw: 0, se: 0, sw: 0 };
  for (const [x, y] of pts) {
    if (x < 0 || x > W || y < 0 || y > H) continue;
    const east = x >= W - w;
    const west = x <= w;
    const north = y <= h;
    const south = y >= H - h;
    if (north && east) c.ne++;
    if (north && west) c.nw++;
    if (south && east) c.se++;
    if (south && west) c.sw++;
  }
  return c;
}

/** The least-covered corner; ties go by `CORNERS` order. The `current`
 *  corner is kept unless another is clearly emptier, so a legend does not hop
 *  between corners on every pan. */
export function pickCorner(counts: Record<Corner, number>, current?: string): Corner {
  let best: Corner = "ne";
  for (const k of CORNERS) if (counts[k] < counts[best]) best = k;
  const cur = CORNERS.find((k) => k === current);
  return cur && counts[cur] <= counts[best] * 1.25 + 2 ? cur : best;
}

/** The tool readout's corner (chrome audit round 4): the least-covered frame
 *  corner other than the legend's, bottom right first on a tie, and sticky
 *  like the legend's. It used to sit at the STAGE's bottom right, which is
 *  the x-axis title once the window is narrow. */
export function pickReadoutCorner(counts: Record<Corner, number>, blocked: readonly string[] = [], current?: string): Corner {
  const all = ["se", "sw", "ne", "nw"] as const;
  const open = all.filter((k) => !blocked.includes(k));
  // Nowhere clear of the legend (a tiny frame): at least not its own corner.
  const free = open.length ? open : all.filter((k) => k !== blocked[0]);
  let best: Corner = free[0];
  for (const k of free) if (counts[k] < counts[best]) best = k;
  const cur = free.find((k) => k === current);
  return cur && counts[cur] <= counts[best] * 1.25 + 2 ? cur : best;
}

/** Place the stage's auto legend (corner), size its outside column, and pick
 *  the tool readout's corner (`data-rc`; shell.css does the placing). */
export function placeLegend(u: uPlot, stage: HTMLElement): void {
  const r = u.over.getBoundingClientRect();
  stage.toggleAttribute("data-narrow-frame", r.width < NARROW_FRAME);
  const pts = drawnPoints(u);
  const out = stage.querySelector<HTMLElement>(":scope > .qzk-legend.out");
  if (out) stage.style.setProperty("--qz-out-w", `${out.offsetWidth}px`);
  // Any in-frame legend: a fixed corner keeps `data-lc` current for a later switch to auto.
  const box = stage.querySelector<HTMLElement>(":scope > .qzk-legend:not(.out)");
  // The readout may not be showing yet (it appears on hover): size it from its rows.
  const ro = stage.querySelector<HTMLElement>(":scope > .qzk-readout");
  const rows = u.series.filter((s, k) => k > 0 && s.show !== false).length + 1;
  const w = (ro?.offsetWidth || 190) + INSET;
  const h = (ro?.offsetHeight || 8 + 16 * rows) + INSET;
  // The legend's corner, then each neighbour the two boxes cannot share.
  const blocked: string[] = [];
  if (box) {
    const lw = box.offsetWidth + INSET;
    const lh = box.offsetHeight + INSET;
    const counts = cornerCounts(pts, r.width, r.height, lw, lh);
    const lc = pickCorner(counts, stage.dataset.lc);
    if (stage.dataset.lc !== lc) stage.dataset.lc = lc;
    const held = box.classList.contains("auto") ? lc : CORNERS.find((k) => box.classList.contains(k));
    if (held) {
      const wide = lw + w + INSET > r.width;
      const tall = lh + h + INSET > r.height;
      const v = held[0] === "n" ? "s" : "n";
      const hz = held[1] === "e" ? "w" : "e";
      blocked.push(held);
      if (wide) blocked.push(held[0] + hz);
      if (tall) blocked.push(v + held[1]);
      if (wide && tall) blocked.push(v + hz);
    }
  }
  const rc = pickReadoutCorner(cornerCounts(pts, r.width, r.height, w, h), blocked, stage.dataset.rc);
  if (stage.dataset.rc !== rc) stage.dataset.rc = rc;
}
