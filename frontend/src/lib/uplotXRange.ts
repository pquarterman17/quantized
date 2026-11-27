// The canvas' X autoscale range when uPlot's own cannot be trusted. Split out
// of `lib/uplotOpts.ts` (shrink-only pin) — `buildOpts` is the only caller.

import type uPlot from "uplot";

import type { PlotPayload } from "./plotdata";
import { flatView } from "./uplotErrorRange";

/** The x scale's range function for a scanned extent (`fullXExtents`). uPlot
 *  calls it on EVERY x `setScale` — a box/wheel zoom and a pan too, not only
 *  on autoscale — so a constant return snapped every zoom back to the full
 *  extent. Only uPlot's own autoscale (`autoScaleX`: construction, a
 *  double-click reset, a re-autoscaling `setData`) gets the scan; an explicit
 *  view keeps its bounds. Autoscale passes the first and last x, or, when they
 *  are equal (a loop that ends where it started), a padded interval around
 *  that value — recognised as the pair of the first such call, which is the
 *  construction autoscale, so no uPlot internals are restated here. uPlot's
 *  setScale swaps a min above max, so a sweep whose first x is ABOVE its last
 *  (a VSM loop starting at +Hmax) arrives as [last, first]. */
export function scannedXRange(extent: [number, number]): uPlot.Range.Function {
  let constructed: [number, number] | null = null;
  return (u, min, max) => {
    if (min == null || max == null) return extent;
    const xs = u.data?.[0];
    if (!xs?.length) return extent;
    const first = xs[0];
    const last = xs[xs.length - 1];
    // An end x that is missing never reaches here as an autoscale (that passes
    // null, answered above): this is an explicit view (a zoom, a pan).
    // BOTH ends blank (a row window inside the sheet, lib/plotRowWindow.ts): uPlot's autoscale reads two nulls as one
    // value and hands a padded pair around it, recognised as the first call, like a loop's.
    if (first == null && last == null) {
      constructed ??= [min, max];
      return min === constructed[0] && max === constructed[1] ? extent : [min, max];
    }
    if (first == null || last == null) return [min, max];
    if (min === Math.min(first, last) && max === Math.max(first, last)) return extent;
    if (!constructed && first === last) constructed = [min, max];
    return constructed && min === constructed[0] && max === constructed[1] ? extent : [min, max];
  };
}

/** Is the x column sorted ascending, so uPlot's ordered fast paths may read it?
 *  Its x scale defaults to `sorted: 1`, deriving the range from the ENDPOINTS
 *  (and a cursor from a binary search) instead of scanning. That breaks for a
 *  non-monotonic x (a magnetometry loop sweeps field up then down, so the first
 *  and last points are both at +saturation: the range collapses to a sliver),
 *  and for an x that STARTS with a missing value (blank cells, NaN): the first
 *  x is null, so the range is [null, last] and the axis never draws; a null
 *  also reads as 0 where uPlot places it. Both take the full-scan path
 *  (`Unsorted`, `fullXExtents`, `fullYExtents`), which draws only rows with a
 *  finite x. Nulls elsewhere are skipped: they do not break monotonicity (a row
 *  window's finite rows are tested this way; `xSortedFast` is the stricter
 *  test that picks uPlot's path). */
export function xIsAscending(xs: readonly (number | null)[]): boolean {
  if (xs.length && !Number.isFinite(xs[0] as number)) return false;
  let prev = -Infinity;
  for (const v of xs) {
    if (v == null) continue;
    if (v < prev) return false;
    prev = v;
  }
  return true;
}

/** May uPlot read the x scale off the column's ENDS (its sorted fast path)? It
 *  must be ascending and have NO missing x anywhere: a null x reads as 0 wherever
 *  uPlot's ordered paths meet it (a leading, trailing or MIDDLE blank cell, the
 *  rows outside a plot's row window, `lib/plotRowWindow.ts`), so a gap anywhere
 *  takes the full-scan paths, which draw and range only rows with an x and break
 *  the line there. One pass, once per payload (`buildOpts`); a column with no
 *  gap, the common case, is exactly as before. Mirrored by `calc/decimate.py`
 *  `is_ascending`. */
export function xSortedFast(xs: readonly (number | null)[]): boolean {
  let prev = -Infinity;
  for (const v of xs) {
    if (v == null || !Number.isFinite(v) || v < prev) return false;
    prev = v;
  }
  return true;
}

export const fixedRanges = new WeakSet<uPlot.Range.Function>();

/** A FIXED X limit (`xLim`) as the x range: the same rule, so the limit is
 *  what autoscale lands on while a zoom, a pan or a live limit change keeps
 *  its bounds — a static `[min, max]` pair is answered on every x setScale
 *  too, pinning the live plot to the limit it was built with. */
export function fixedXRange(lim: [number, number]): uPlot.Range.Function {
  const fn = scannedXRange(lim);
  fixedRanges.add(fn);
  return fn;
}

/** A [min, max] x data domain lightly padded — the canvas' x margin rule.
 *  Log AND reciprocal pad multiplicatively (their domain is positive only). */
export function padXDomain([min, max]: readonly [number, number], positiveOnly: boolean): [number, number] {
  const flat = min === max && flatView(min, positiveOnly);
  if (flat) return flat; // a flat x: uPlot's own view
  if (positiveOnly) return [min / 1.1, max * 1.1];
  const pad = (max - min || Math.abs(max) || 1) * 0.02; // slim x margin, avoid edge clipping
  return [min - pad, max + pad];
}

/** Full-scan [min, max] of the finite x values, lightly padded — the X
 *  counterpart of fullYExtents. For non-monotonic x (a hysteresis loop sweeps
 *  field up then down, so it starts and ends near the SAME saturation), uPlot's
 *  binary-search autorange collapses the axis to [first, last] — a sliver near
 *  one end. Scanning restores the true sweep width. Log AND reciprocal
 *  consider positive x only. Null when nothing qualifies (leave uPlot's
 *  default alone).
 *
 *  Only the x of a point some visible series draws counts, the domain the
 *  export autoscales to: a waterfall X-offset payload (`blockRows`,
 *  `lib/waterfallX.ts`) holds a hidden series' shifted block and an excluded
 *  row's x (`tests/fixtures/wire/waterfall_x_domain.json`), and a sheet whose
 *  other columns start earlier holds end rows no plotted series draws. */
export function fullXExtents(payload: PlotPayload, hidden: boolean[] | undefined, positiveOnly: boolean, exact = false): [number, number] | null {
  const [xs, ...ys] = payload.data as (number | null)[][];
  const drawn = ys.length ? ys.filter((_, i) => !hidden?.[i]) : null;
  let min = Infinity;
  let max = -Infinity;
  xs.forEach((v, r) => {
    if (v == null || !Number.isFinite(v) || (positiveOnly && v <= 0)) return;
    if (drawn && !drawn.some((y) => y[r] != null && Number.isFinite(y[r]))) return;
    if (v < min) min = v;
    if (v > max) max = v;
  });
  // `exact`: a row window of an ascending x, whose export holds only those rows and so, like any ascending x, is unpadded.
  return min > max ? null : exact && min < max ? [min, max] : padXDomain([min, max], positiveOnly);
}

/** A FIXED Y/Y2 limit as the scale options. uPlot draws a scale whose min is
 *  above its max with no ticks at all, so a descending pair (an Origin axis
 *  decoded from > to: EIS Nyquist plots -Im(Z) down the page) is handed over
 *  ascending with `dir: -1`, which flips the axis on screen and keeps the tick
 *  labels, now in reversed order. */
export function fixedYScale(lim: [number, number]): Pick<uPlot.Scale, "range" | "dir"> {
  return lim[0] > lim[1] ? { range: [lim[1], lim[0]], dir: -1 } : { range: lim };
}

// `isFixedXRange` live in ./uplotXRangeFixed.ts: no eager module uses them.
export * from "./uplotXRangeFixed";
