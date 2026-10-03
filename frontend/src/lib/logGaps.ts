// A value <= 0 has no place on a log axis. uPlot clamps it to a tenth of the
// scale minimum, so a line through it dropped to the bottom edge (spin-flip
// PNR, background-subtracted reflectivity, zero-count XRD). This uPlot
// `series.gaps` refiner turns each run of such points into a gap, the break a
// null makes; the data are untouched. The export masks the same points
// (`calc/figure_scale.mask_nonpositive`). uPlot clips gaps by x pixel, so
// `uplotSeries` sets it only on ascending x.

import type uPlot from "uplot";

/** uPlot's null gaps plus, for each point a log x or y cannot place, the span
 *  from the point before it to the point after it, in x order (overlapping
 *  spans of a run chain into one break, as uPlot's `clipGaps` walks them). */
export const logGaps = (u: uPlot, sidx: number, i0: number, i1: number, gaps: uPlot.Series.Gaps): uPlot.Series.Gaps => {
  const xs = u.data[0];
  const ys = u.data[sidx];
  const logX = (u.scales.x.distr as number) === 3;
  const logY = (u.scales[u.series[sidx].scale!].distr as number) === 3;
  if (!logX && !logY) return gaps;
  const px = (i: number) => u.valToPos(xs[i] ?? xs[i1], "x", true);
  const out = [...gaps];
  for (let i = i0; i <= i1; i++) {
    if ((logY && ys[i] != null && ys[i]! <= 0) || (logX && xs[i] <= 0)) out.push([px(i && i - 1), px(i + 1)]);
  }
  return out.sort((p, q) => p[0] - q[0]);
};
