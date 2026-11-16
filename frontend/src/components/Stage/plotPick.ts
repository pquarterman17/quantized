// UX-A: what a Pointer-tool click on the plot selects, and the geometry of the
// selection highlight drawn for it. Pure over a live uPlot (or a stand-in with
// the same few members), so both halves are unit-tested without a canvas.
// Loaded only with the lazy PlotSelectionLayer.
//
// Both halves read the curve the way it is DRAWN:
// - only the points inside the current scale window (plus the one either side
//   of it, so a segment still runs to the plot edge), decimated per pixel
//   column (first / min / max / last of each run of points in one column,
//   which keeps a narrow peak), so a zoomed-in view stays exact and a 100k-row
//   curve stays cheap;
// - in 2-D screen distance to the drawn segments, so both branches of a
//   hysteresis loop (non-monotonic X) can be picked;
// - turn-aware: a horizontal-bar plot turns the x scale (`ori: 1`, see
//   lib/uplotOrient.ts), so x maps to the vertical. `isTurned` is the one hook
//   for any other exchanged-axes mode that turns the x scale the same way.

import type uPlot from "uplot";

import { axisZoneAt } from "../../lib/plotHitTest";
import type { PlotSelection } from "../../store/plotSelection";
import { OBJECT_CURSORS } from "./usePlotStageActions";

/** How close (CSS px) a click must land to a drawn curve to select it — the
 *  curve double-click's own tolerance. */
export const CURVE_PICK_PX = 12;

type Pt = [number, number];
type Rect = Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">;

/** The plot is drawn turned: x runs vertically (horizontal bars). */
export function isTurned(u: uPlot): boolean {
  return u.scales.x?.ori === 1;
}

function inScale(u: uPlot, key: string, v: number): boolean {
  const s = u.scales[key];
  return (s?.min == null || v >= s.min) && (s?.max == null || v <= s.max);
}

/** The drawn vertices of display series `i` in plot-area CSS px, as runs
 *  broken at gaps and at stretches outside the scale window. */
export function visibleRuns(u: uPlot, i: number): Pt[][] {
  const xs = (u.data[0] ?? []) as (number | null | undefined)[];
  const ys = (u.data[i + 1] ?? []) as (number | null | undefined)[];
  const scale = u.series[i + 1]?.scale ?? "y";
  const turned = isTurned(u);
  const finite = (r: number) => {
    const xv = xs[r];
    const yv = ys[r];
    return xv != null && yv != null && Number.isFinite(xv) && Number.isFinite(yv);
  };
  const inside = (r: number) => r >= 0 && r < xs.length && finite(r) && inScale(u, "x", xs[r] as number) && inScale(u, scale, ys[r] as number);
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  // The current pixel column's points (index order): first, min, max, last.
  let col: number | null = null;
  let bucket: { first: Pt; last: Pt; lo: Pt; hi: Pt; loAt: number; hiAt: number } | null = null;
  const flush = () => {
    if (!bucket) return;
    const b = bucket;
    const mid = b.loAt <= b.hiAt ? [b.lo, b.hi] : [b.hi, b.lo];
    for (const p of [b.first, ...mid, b.last]) {
      const prev = run[run.length - 1];
      if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) run.push(p);
    }
    bucket = null;
    col = null;
  };
  const endRun = () => {
    flush();
    if (run.length) runs.push(run);
    run = [];
  };
  for (let r = 0; r < xs.length; r++) {
    if (!finite(r) || !(inside(r) || inside(r - 1) || inside(r + 1))) {
      endRun();
      continue;
    }
    const a = u.valToPos(xs[r] as number, "x", false);
    const b = u.valToPos(ys[r] as number, scale, false);
    const p: Pt = turned ? [b, a] : [a, b];
    // Columns run along the x direction: across the plot, or up it when turned.
    const c = Math.round(turned ? p[1] : p[0]);
    const v = turned ? p[0] : p[1];
    if (c !== col) {
      flush();
      col = c;
      bucket = { first: p, last: p, lo: p, hi: p, loAt: r, hiAt: r };
      continue;
    }
    if (!bucket) continue;
    bucket.last = p;
    if (v < (turned ? bucket.lo[0] : bucket.lo[1])) Object.assign(bucket, { lo: p, loAt: r });
    if (v > (turned ? bucket.hi[0] : bucket.hi[1])) Object.assign(bucket, { hi: p, hiAt: r });
  }
  endRun();
  return runs;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Display index of the drawn curve nearest (2-D) to plot-area point `p`,
 *  within `maxPx`; null when none is that close. */
export function nearestCurve(u: uPlot, p: Pt, count: number, maxPx: number): number | null {
  let best: number | null = null;
  let bestD = maxPx;
  for (let i = 0; i < count; i++) {
    const ser = u.series[i + 1];
    if (!ser || ser.show === false) continue;
    const dots = ser.width === 0;
    for (const run of visibleRuns(u, i)) {
      // A markers-only curve (or a lone point) is its points; a line, its segments.
      const asPoints = dots || run.length === 1;
      for (let k = 0; k < (asPoints ? run.length : run.length - 1); k++) {
        const a = run[k] as Pt;
        const d = asPoints ? Math.hypot(p[0] - a[0], p[1] - a[1]) : segDist(p, a, run[k + 1] as Pt);
        if (d <= bestD) {
          bestD = d;
          best = i;
        }
      }
    }
  }
  return best;
}

/** The value axes drawn beside the plot area, nearest first, on each side. */
function sideAxes(u: uPlot, o: Rect): { left: DOMRect[]; right: DOMRect[] } {
  const boxes = [...u.root.querySelectorAll(".u-axis")].map((el) => el.getBoundingClientRect()).filter((b) => b.width > 0 && b.height > 0);
  return {
    left: boxes.filter((b) => b.right <= o.left + 1).sort((a, b) => b.left - a.left),
    right: boxes.filter((b) => b.left >= o.right - 1).sort((a, b) => a.left - b.left),
  };
}

/** The selection for a click at client (x, y) on `target`: a curve, an axis,
 *  the legend, null (empty plot area: clear), or undefined when the click
 *  belongs to something else (an annotation / shape / reference line, a
 *  legend's visibility toggle or buttons, the toolbar, a title, an extra Y3+
 *  axis) and the selection must stay as it is. */
export function pickAt(
  u: uPlot,
  target: Element,
  x: number,
  y: number,
  plotted: readonly number[],
  hasY2: boolean,
): PlotSelection | null | undefined {
  const legend = target.closest(".qzk-legend");
  if (legend) {
    // The visibility toggle (swatch), reorder arrows and the rename field act
    // on their own; a row selects its curve; the box selects the legend.
    if (target.closest(".qzk-legend-toggle, button, input")) return undefined;
    const row = target.closest<HTMLElement>("[data-channel]");
    const channel = row ? Number(row.dataset.channel) : NaN;
    return Number.isInteger(channel) && channel >= 0 ? { kind: "series", channel } : { kind: "legend" };
  }
  const o: Rect = u.over.getBoundingClientRect();
  if (u.over.contains(target)) {
    // An object plugin shows a move / resize cursor over what it owns, and
    // already selected it on mousedown.
    if (OBJECT_CURSORS.has(u.over.style.cursor)) return undefined;
    const i = nearestCurve(u, [x - o.left, y - o.top], plotted.length, CURVE_PICK_PX);
    const channel = i != null ? plotted[i] : undefined;
    return channel !== undefined ? { kind: "series", channel } : null;
  }
  if (!u.root.contains(target)) return undefined;
  // The axis band beside the plot area (the double-click's own zones). With
  // Y3+ axes the band holds several: only the one next to the plot area is X /
  // Y / Y2; an extra axis selects nothing (its own dialog is a double-click).
  const zone = axisZoneAt(x, y, o, hasY2);
  if (zone === "x") return { kind: "axis", axis: "x" };
  if (zone !== "y" && zone !== "y2") return undefined;
  const { left, right } = sideAxes(u, o);
  const near = zone === "y" ? left[0] : right[0];
  const beyond = zone === "y" ? left.length > 1 && x < (near?.left ?? -Infinity) : right.length > 1 && x > (near?.right ?? Infinity);
  return beyond ? undefined : { kind: "axis", axis: zone };
}

export interface HaloGeometry {
  /** SVG path in STAGE coordinates (a curve), or "" for none. */
  d: string;
  /** Stroke width (CSS px) of the curve halo. */
  width: number;
  /** A rectangle in stage coordinates (an axis band or the legend box). */
  box: { x: number; y: number; w: number; h: number } | null;
  /** The plot area in stage coordinates: the curve halo is clipped to it. */
  clip: { x: number; y: number; w: number; h: number };
}

/** The highlight for `sel`, relative to `stage` (the element the halo SVG
 *  fills). A curve gets a wide translucent stroke along its drawn points
 *  (round dots for a markers-only series), clipped to the plot area; an axis
 *  its band beside the plot area; the legend its own box. */
export function haloGeometry(u: uPlot, stage: Element, sel: PlotSelection, plotted: readonly number[]): HaloGeometry {
  const s: Rect = stage.getBoundingClientRect();
  const o: Rect = u.over.getBoundingClientRect();
  const clip = { x: o.left - s.left, y: o.top - s.top, w: o.width, h: o.height };
  const none: HaloGeometry = { d: "", width: 0, box: null, clip };
  if (sel.kind === "legend") {
    const el = stage.querySelector(".qzk-legend");
    if (!el) return none;
    const r = el.getBoundingClientRect();
    return { ...none, box: { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height } };
  }
  if (sel.kind === "axis") {
    const r: Rect = u.root.getBoundingClientRect();
    const { left, right } = sideAxes(u, o);
    const yLeft = left[0]?.left ?? r.left;
    const y2Right = right[0]?.right ?? r.right;
    const box =
      sel.axis === "x"
        ? { x: o.left, y: o.bottom, w: o.width, h: r.bottom - o.bottom }
        : sel.axis === "y"
          ? { x: yLeft, y: o.top, w: o.left - yLeft, h: o.height }
          : { x: o.right, y: o.top, w: y2Right - o.right, h: o.height };
    return { ...none, box: { ...box, x: box.x - s.left, y: box.y - s.top } };
  }
  const i = plotted.indexOf(sel.channel);
  const ser = u.series[i + 1];
  if (i < 0 || !ser || ser.show === false) return none;
  const dots = ser.width === 0;
  const f = (n: number) => n.toFixed(1);
  const parts: string[] = [];
  for (const run of visibleRuns(u, i)) {
    run.forEach(([px, py], k) => {
      const at = `${f(px + clip.x)},${f(py + clip.y)}`;
      parts.push(dots ? `M${at}h0` : `${k === 0 ? "M" : "L"}${at}`);
    });
  }
  const lineW = typeof ser.width === "number" && ser.width > 0 ? ser.width : 1.5;
  return { d: parts.join(""), width: dots ? 12 : lineW + 6, box: null, clip };
}

const ids = new WeakMap<object, number>();
let nextId = 1;
function idOf(o: object | null | undefined): number {
  if (!o) return 0;
  let id = ids.get(o);
  if (id === undefined) ids.set(o, (id = nextId++));
  return id;
}

/** Everything `haloGeometry` reads, as a cheap string: the frame loop
 *  recomputes the halo only when this changes (every scale window, the plot
 *  and stage boxes, the uPlot instance, its data arrays, the series' show /
 *  width, the legend box for a legend selection). */
export function haloKey(u: uPlot, stage: Element, sel: PlotSelection, plotted: readonly number[]): string {
  const r = (b: Rect) => `${b.left},${b.top},${b.width},${b.height}`;
  const scales = Object.entries(u.scales).map(([k, v]) => `${k}:${v.min},${v.max},${v.ori ?? 0}`);
  const series = u.series.map((ser) => `${ser.show !== false ? 1 : 0}${ser.width ?? ""}`);
  const legend = sel.kind === "legend" ? stage.querySelector(".qzk-legend") : null;
  return [
    idOf(u),
    u.data.map((col) => idOf(col as object)).join(","),
    scales.join(";"),
    series.join(","),
    r(u.over.getBoundingClientRect()),
    r(u.root.getBoundingClientRect()),
    r(stage.getBoundingClientRect()),
    legend ? r(legend.getBoundingClientRect()) : "",
    plotted.join(","),
    JSON.stringify(sel),
  ].join("|");
}
