// The canvas' X autoscale range when uPlot's own cannot be trusted. Split out
// of `lib/uplotOpts.ts` (shrink-only pin) — `buildOpts` is the only caller.

import type { PlotPayload } from "./plotdata";

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
