// Bars from zero at each X, as a uPlot path builder (`SeriesStyle.bars` —
// an Origin column / bar graph restored on the XY stage). Hand-rolled with
// uPlot's PUBLIC pixel mapping (`u.valToPos`) and a type-only uPlot import,
// like `uplotPaths.STEPPED_MID_PATHS`, so `uplotSeries` can use it without
// the uPlot runtime. The bar width is 60% of the smallest gap between
// neighbouring X positions (a lone point gets 12 px); the export draws the
// same rule (`calc/figure_bars.py`). A null X or Y draws no bar.
import type uPlot from "uplot";

export const BAR_FRACTION = 0.6;

export const BAR_PATHS: uPlot.Series.PathBuilder = (u, seriesIdx, idx0, idx1) => {
  const xs = u.data[0];
  const ys = u.data[seriesIdx];
  const scale = u.series[seriesIdx].scale ?? "y";
  const px: number[] = [];
  for (let i = idx0; i <= idx1; i++) {
    const x = xs[i];
    if (x != null) px.push(u.valToPos(x, "x", true));
  }
  px.sort((a, b) => a - b);
  let gap = Infinity;
  for (let k = 1; k < px.length; k++) if (px[k] > px[k - 1]) gap = Math.min(gap, px[k] - px[k - 1]);
  const width = Number.isFinite(gap) ? gap * BAR_FRACTION : 12;
  const base = u.valToPos(0, scale, true);
  const path = new Path2D();
  for (let i = idx0; i <= idx1; i++) {
    const x = xs[i];
    const y = ys[i];
    if (x == null || y == null) continue;
    const cx = u.valToPos(x, "x", true);
    const cy = u.valToPos(y, scale, true);
    path.rect(cx - width / 2, Math.min(cy, base), width, Math.abs(base - cy));
  }
  return { stroke: path, fill: path };
};
