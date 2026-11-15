// A value <= 0 has no place on a log axis. uPlot clamps it to a tenth of the
// scale minimum, so a line through it dropped to the bottom edge (spin-flip
// PNR, background-subtracted reflectivity, zero-count XRD). This uPlot
// `series.gaps` refiner turns each run of such points into a gap, the break a
// null makes; the data are untouched. The export masks the same points
// (`calc/figure_scale.mask_nonpositive`). uPlot clips gaps by x pixel, so
// `uplotSeries` sets it only on ascending x.
//
// A custom scale (uPlot `distr: 100`: a probability or reciprocal axis) has
// points it cannot place either -- its transform gives NaN, which the canvas
// silently skips, joining the neighbours across them. Those break the line
// too, as the export's NaN break does (gap audit 4 G17).

import type uPlot from "uplot";

/** uPlot's null gaps plus, for each point a log or custom x or y cannot
 *  place, the span from the point before it to the point after it, in x
 *  order (overlapping spans of a run chain into one break, as uPlot's
 *  `clipGaps` walks them). */
export const logGaps = (u: uPlot, sidx: number, i0: number, i1: number, gaps: uPlot.Series.Gaps): uPlot.Series.Gaps => {
  const xs = u.data[0];
  const ys = u.data[sidx];
  const yKey = u.series[sidx].scale!;
  const xd = u.scales.x.distr as number;
  const yd = u.scales[yKey].distr as number;
  if (xd !== 3 && yd !== 3 && xd !== 100 && yd !== 100) return gaps;
  const off = (v: number | null | undefined, key: string, d: number): boolean =>
    v != null && (d === 3 ? v <= 0 : d === 100 && !Number.isFinite(u.valToPos(v, key, true)));
  const px = (i: number) => u.valToPos(xs[i] ?? xs[i1], "x", true);
  const out = [...gaps];
  for (let i = i0; i <= i1; i++) {
    if (off(ys[i], yKey, yd) || off(xs[i], "x", xd)) out.push([px(i && i - 1), px(i + 1)]);
  }
  return out.sort((p, q) => p[0] - q[0]);
};
