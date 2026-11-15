// The "Spline" line connect's path builder (gap audit 3, N6). Hand-rolled over
// `u.valToPos` like `STEPPED_MID_PATHS` (uplotPaths.ts) so it needs no uPlot
// runtime and every caller of `buildSeriesDefs` gets it without a prop.
//
// It strokes the natural cubic spline of `lib/cubicSpline.ts` (cached per data
// identity) — the curve the export draws. Where X is not strictly ascending (a
// hysteresis loop, a repeated X) or there are too many rows it strokes the plain
// polyline over EVERY row in acquisition order instead: never resorted, never
// splined. A null/NaN row breaks the line. The window `i0..i1` is ignored (the
// whole curve is drawn and the plot area clips it) because a spline between
// knots must not depend on the zoom.
//
// A fill under the series follows the SAME path (closed down to the zero line),
// as the export's fill under the dense curve does.

import type uPlot from "uplot";

import { splineDenseCached } from "./cubicSpline";

type Cell = number | null | undefined;

export const SPLINE_PATHS: uPlot.Series.PathBuilder = (u, seriesIdx) => {
  const s = u.series[seriesIdx];
  const scaleKey = s.scale ?? "y";
  const xs = u.data[0] as Cell[];
  const ys = u.data[seriesIdx] as unknown as Cell[];
  const dense = splineDenseCached(xs, ys);
  const px: ArrayLike<Cell> = dense ? dense.x : xs;
  const py: ArrayLike<Cell> = dense ? dense.y : ys;
  const log = (u.scales[scaleKey]?.distr as number | undefined) === 3;
  const stroke = new Path2D();
  const fill = s.fill ? new Path2D() : null;
  const base = fill ? u.valToPos(0, scaleKey, true) : NaN; // the fill-under baseline (zero)
  let pen = false;
  let lastX = 0;
  const close = () => {
    if (fill && pen && Number.isFinite(base)) { fill.lineTo(lastX, base); fill.closePath(); }
  };
  for (let i = 0; i < px.length; i++) {
    const x = px[i];
    const y = py[i];
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y) || (log && y <= 0)) {
      close();
      pen = false;
      continue;
    }
    const X = u.valToPos(x, "x", true);
    const Y = u.valToPos(y, scaleKey, true);
    if (pen) { stroke.lineTo(X, Y); fill?.lineTo(X, Y); }
    else { stroke.moveTo(X, Y); if (fill && Number.isFinite(base)) { fill.moveTo(X, base); fill.lineTo(X, Y); } }
    pen = true;
    lastX = X;
  }
  close();
  return { stroke, fill, clip: null, band: null };
};
