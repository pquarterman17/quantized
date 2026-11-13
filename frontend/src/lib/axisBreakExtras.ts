// The uPlot half of a Y-axis break (`AxisFormat.breaks`, the Axis dialog's
// "Break" rows): turns the axis' scale into the broken one `lib/axisBreaks.ts`
// defines, gives it break-aware ticks and auto range, and draws the two
// diagonal break marks on the axis line. Split out of `lib/axisExtras.ts`
// (which calls it per axis) so each module stays one idea; loaded on demand
// with it.
//
// Only a LINEAR Y or Y2 axis breaks this way. A log or reciprocal axis keeps
// its own scale (the Axis dialog refuses the combination), and the X axis
// breaks as side-by-side panels (`lib/facet.breakPayloads`).

import type uPlot from "uplot";

import { breakAutoRange, breakBackward, breakForward, breakGap, breakTicks, type AxisBreak } from "./axisBreaks";

type ValuesFn = Extract<NonNullable<uPlot.Axis["values"]>, (...args: never[]) => unknown>;

/** What `uplotOpts.buildOpts` hands the extras beyond the axes themselves. */
export interface AxisExtrasContext {
  /** The scales object `buildOpts` is about to return (edited in place). */
  scales: uPlot.Scales;
  /** The drawn payload: `data[0]` is x, then one column per series. */
  payload: { data: ArrayLike<ArrayLike<number | null | undefined>>; series: readonly { axis?: number }[] };
  /** Per axis (x, y, y2): a typed limit ranges it, so no auto range applies. */
  typed: readonly boolean[];
  /** Per axis: the typed major increment, if any. */
  steps: readonly (number | null | undefined)[];
  /** Y is ranged by a full scan of the data (a non-ascending x -- a
   *  hysteresis loop -- where uPlot's windowed min/max cannot be trusted). */
  scan: boolean;
  /** Per series: hidden (it draws nothing, so it sizes neither gap nor range). */
  hidden?: readonly boolean[];
  /** The Y2 axis has a format of its own (an inherited one carries the
   *  primary axis' breaks, which mean nothing in Y2's units). */
  y2Own: boolean;
  /** Panels sharing one y (x-break panels): the y data extent of ALL of
   *  them, so each panel's gap -- and so each panel's positions -- agree
   *  (the export sizes its one shared break the same way). */
  extent?: [number, number] | null;
}

/** Finite min/max of every series riding axis `on` (0 = y, 1 = y2), or null. */
export function seriesExtent(payload: AxisExtrasContext["payload"], on: 0 | 1, hidden?: readonly boolean[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let s = 1; s < payload.data.length; s++) {
    if ((payload.series[s - 1]?.axis ?? 0) !== on || hidden?.[s - 1]) continue;
    const col = payload.data[s];
    for (let r = 0; r < col.length; r++) {
      const v = col[r];
      if (v != null && Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  return hi >= lo ? [lo, hi] : null;
}

/** The breaks axis `idx` (1 = y, 2 = y2) actually draws, or null: none on x,
 *  none off a linear scale, none inherited by y2. */
export function activeBreaks(
  idx: number,
  breaks: readonly AxisBreak[] | undefined,
  scale: string,
  ctx: AxisExtrasContext | undefined,
): readonly AxisBreak[] | null {
  if (!ctx || !breaks?.length || idx === 0 || scale !== "linear") return null;
  if (idx === 2 && !ctx.y2Own) return null;
  return breaks;
}

/** Make `axis` (and its scale in `ctx.scales`) a broken axis. */
export function applyAxisBreaks(axis: uPlot.Axis, idx: number, breaks: readonly AxisBreak[], ctx: AxisExtrasContext): void {
  const key = axis.scale ?? "y";
  const extent = (idx === 1 ? ctx.extent : null) ?? seriesExtent(ctx.payload, idx === 2 ? 1 : 0, ctx.hidden);
  const gap = extent ? breakGap(breaks, extent[0], extent[1]) : breakGap(breaks, 0, 0);
  const scale: uPlot.Scale = {
    ...ctx.scales[key],
    distr: 100,
    fwd: (v: number) => breakForward(v, breaks, gap),
    bwd: (p: number) => breakBackward(p, breaks, gap),
  };
  if (!ctx.typed[idx]) {
    scale.range = (_u, dataMin, dataMax) => {
      const [lo, hi] = ctx.scan && extent ? extent : [dataMin, dataMax];
      if (lo == null || hi == null) return [null, null] as unknown as uPlot.Range.MinMax;
      return breakAutoRange(lo, hi, breaks);
    };
  }
  ctx.scales[key] = scale;
  const step = ctx.steps[idx];
  axis.splits = (_u, _i, min, max) => breakTicks(min, max, breaks, step);
  // Every split gets its label. uPlot's default label filter for any scale
  // with distr >= 3 is the LOG one (it keeps 1/2/5 x 10^n), and a custom
  // scale is distr 100: in the live check a 0..6 | 996..1008 axis labelled
  // only "2" and "1,000".."1,008".
  axis.filter = (_u, splits) => splits;
  if (typeof axis.values === "function") {
    // The formatter sizes its decimals from the tick increment; hand it the
    // increment of the ticks actually drawn, not uPlot's own (found for the
    // unbroken span).
    const inner = axis.values as ValuesFn;
    axis.values = (u, splits, axisIdx, space, incr) => {
      let drawn = incr;
      for (let i = 1; i < splits.length; i++) drawn = i === 1 ? splits[1] - splits[0] : Math.min(drawn, splits[i] - splits[i - 1]);
      return inner(u, splits, axisIdx, space, drawn > 0 ? drawn : incr);
    };
  }
}

/** Is `v` strictly inside one of `breaks`? (No tick, major or minor, there.) */
export const insideBreak = (v: number, breaks: readonly AxisBreak[]): boolean => breaks.some(([lo, hi]) => v > lo && v < hi);

/** The two diagonal break marks at each break, across the axis line at
 *  `edge` (canvas px): one at the lower edge of the gap, one at the upper. */
export function drawBreakMarks(u: uPlot, key: string, edge: number, breaks: readonly AxisBreak[], pr: number): void {
  const { ctx } = u;
  const half = 5 * pr;
  const rise = 2.5 * pr;
  ctx.save();
  ctx.lineWidth = 1.25 * pr;
  for (const [lo, hi] of breaks) {
    for (const v of [lo, hi]) {
      const p = u.valToPos(v, key, true);
      if (!Number.isFinite(p)) continue;
      ctx.beginPath();
      ctx.moveTo(edge - half, p + rise);
      ctx.lineTo(edge + half, p - rise);
      ctx.stroke();
    }
  }
  ctx.restore();
}
