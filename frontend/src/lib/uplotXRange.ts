// The canvas' X autoscale range when uPlot's own cannot be trusted. Split out
// of `lib/uplotOpts.ts` (shrink-only pin) — `buildOpts` is the only caller.

import type uPlot from "uplot";

import type { PlotPayload } from "./plotdata";

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
    if (min === Math.min(first, last) && max === Math.max(first, last)) return extent;
    if (!constructed && first === last) constructed = [min, max];
    return constructed && min === constructed[0] && max === constructed[1] ? extent : [min, max];
  };
}

const fixedRanges = new WeakSet<uPlot.Range.Function>();

/** A FIXED X limit (`xLim`) as the x range: the same rule, so the limit is
 *  what autoscale lands on while a zoom, a pan or a live limit change keeps
 *  its bounds — a static `[min, max]` pair is answered on every x setScale
 *  too, pinning the live plot to the limit it was built with. */
export function fixedXRange(lim: [number, number]): uPlot.Range.Function {
  const fn = scannedXRange(lim);
  fixedRanges.add(fn);
  return fn;
}

/** Is this x range a fixed limit (`fixedXRange`), not an autoscale scan? */
export function isFixedXRange(range: unknown): range is uPlot.Range.Function {
  return typeof range === "function" && fixedRanges.has(range as uPlot.Range.Function);
}

/** A [min, max] x data domain lightly padded — the canvas' x margin rule.
 *  Log AND reciprocal pad multiplicatively (their domain is positive only). */
export function padXDomain([min, max]: readonly [number, number], positiveOnly: boolean): [number, number] {
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
 *  A waterfall X-offset payload (`blockRows` set, `lib/waterfallX.ts`) holds
 *  one x block per display slot, so its x column is NOT what is drawn: a
 *  hidden series keeps its shifted block, and an excluded row its x. There
 *  only the x of a point some visible series draws counts — every shifted
 *  series is covered and nothing else, the domain the export autoscales to
 *  (`tests/fixtures/wire/waterfall_x_domain.json`). */
export function fullXExtents(payload: PlotPayload, hidden: boolean[] | undefined, positiveOnly: boolean): [number, number] | null {
  const [xs, ...ys] = payload.data as (number | null)[][];
  const drawn = payload.blockRows ? ys.filter((_, i) => !hidden?.[i]) : null;
  let min = Infinity;
  let max = -Infinity;
  xs.forEach((v, r) => {
    if (v == null || !Number.isFinite(v) || (positiveOnly && v <= 0)) return;
    if (drawn && !drawn.some((y) => y[r] != null && Number.isFinite(y[r]))) return;
    if (v < min) min = v;
    if (v > max) max = v;
  });
  return min > max ? null : padXDomain([min, max], positiveOnly);
}

/** An ascending x column's DRAWN span when rows no visible series draws pad
 *  its ends (a sheet whose other columns start earlier): uPlot ranges x over
 *  the whole column, the export over the drawn points. Unpadded, as uPlot's
 *  own x. Null when both end rows are drawn, or nothing is. */
export function drawnXSpan(payload: PlotPayload, hidden: boolean[] | undefined, positiveOnly = false): [number, number] | null {
  const [xs, ...ys] = payload.data as (number | null)[][];
  const drawn = (r: number) => Number.isFinite(xs[r]) && ys.some((y, i) => !hidden?.[i] && y[r] != null && Number.isFinite(y[r]));
  let a = 0;
  let b = xs.length - 1;
  while (a <= b && !drawn(a)) a++;
  while (b > a && !drawn(b)) b--;
  if (!ys.length || a > b || (a === 0 && b === xs.length - 1) || (positiveOnly && (xs[a] as number) <= 0)) return null;
  return (xs[a] as number) < (xs[b] as number) ? [xs[a] as number, xs[b] as number] : null;
}
