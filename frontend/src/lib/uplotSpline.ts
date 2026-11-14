// The "Spline" line connect's path builder (gap audit 3, N6). Hand-rolled over
// `u.valToPos` like `STEPPED_MID_PATHS` (uplotPaths.ts) so it needs no uPlot
// runtime and every caller of `buildSeriesDefs` gets it without a prop.
//
// It strokes the natural cubic spline of `lib/cubicSpline.ts` — the curve the
// export draws. Where X is not strictly ascending (a hysteresis loop, a
// repeated X) it strokes the plain polyline over EVERY row in acquisition
// order instead: never resorted, never splined. A null/NaN row breaks the line.
// The window `i0..i1` is ignored (the whole curve is drawn and the plot area
// clips it) because a spline between knots must not depend on the zoom; a
// fill under a spline is therefore not supported (`fill` is null), as for the
// mid-step builder.

import type uPlot from "uplot";

import { splineDense } from "./cubicSpline";

type Cell = number | null | undefined;

export const SPLINE_PATHS: uPlot.Series.PathBuilder = (u, seriesIdx) => {
  const scaleKey = u.series[seriesIdx].scale ?? "y";
  const xs = u.data[0] as Cell[];
  const ys = u.data[seriesIdx] as unknown as Cell[];
  const dense = splineDense(xs, ys);
  const px: Cell[] = dense ? dense.x : xs;
  const py: Cell[] = dense ? dense.y : ys;
  const log = (u.scales[scaleKey]?.distr as number | undefined) === 3;
  const stroke = new Path2D();
  let pen = false;
  for (let i = 0; i < px.length; i++) {
    const x = px[i];
    const y = py[i];
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y) || (log && y <= 0)) {
      pen = false;
      continue;
    }
    const X = u.valToPos(x, "x", true);
    const Y = u.valToPos(y, scaleKey, true);
    if (pen) stroke.lineTo(X, Y);
    else stroke.moveTo(X, Y);
    pen = true;
  }
  return { stroke, fill: null, clip: null, band: null };
};
