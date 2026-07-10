// Pure hit-testing for the plot context menu (right-click on the canvas). These
// functions are deliberately framework/uPlot-free so they unit-test without a
// canvas (jsdom can't rasterise): the impure wiring in PlotContextMenu.tsx reads
// pixel positions off the live uPlot instance (posToVal/valToPos/over rect) and
// feeds plain numbers/arrays in here.
//
//   axisZoneAt      — which axis gutter (or the plot body) the cursor sits in
//   nearestIndex    — the x-sample closest to the cursor (over the x data array)
//   pickNearestSeries — the display-series whose curve passes nearest the cursor

export type AxisZone = "x" | "y" | "y2" | "plot" | "outside";

export interface PlotRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Which axis region a cursor (`cx`,`cy`, in the SAME coord space as `rect`)
 *  sits in relative to the plotting rectangle:
 *   - inside the rect         → "plot"  (caller offers both X and Y entries)
 *   - directly below it       → "x"     (the bottom X-axis gutter)
 *   - directly left of it     → "y"     (the primary Y-axis gutter)
 *   - directly right of it    → "y2"    (only when a secondary axis exists)
 *   - anywhere else / corners → "outside"
 *  A right edge without a y2 scale falls through to "outside" (no y2 to edit). */
export function axisZoneAt(cx: number, cy: number, rect: PlotRect, hasY2: boolean): AxisZone {
  const inX = cx >= rect.left && cx <= rect.right;
  const inY = cy >= rect.top && cy <= rect.bottom;
  if (inX && inY) return "plot";
  if (inX && cy > rect.bottom) return "x";
  if (inY && cx < rect.left) return "y";
  if (inY && cx > rect.right) return hasY2 ? "y2" : "outside";
  return "outside";
}

/** Index of the finite x-sample closest to `xVal`, or null when the x data is
 *  empty/all-null. Pure over the x column, so it stands in for uPlot's
 *  `cursor.idx` in tests. */
export function nearestIndex(xData: readonly (number | null)[], xVal: number): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (let i = 0; i < xData.length; i++) {
    const x = xData[i];
    if (x == null || Number.isNaN(x)) continue;
    const d = Math.abs(x - xVal);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Display-series index whose point at the probe x-index is vertically closest
 *  to the cursor. `seriesPy[i]` is that series' pixel-y at the probe index
 *  (null = no sample there, or the series is hidden → skipped). Returns null
 *  when nothing qualifies OR the nearest curve is further than `maxDist` px
 *  away (so a right-click in empty plot space shows axis/plot entries only,
 *  not a spurious series header). Comparing in pixel space keeps primary- and
 *  secondary-axis series on equal footing (the caller maps each through the
 *  right scale before calling in). */
export function pickNearestSeries(
  cursorPy: number,
  seriesPy: readonly (number | null)[],
  maxDist = Infinity,
): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (let i = 0; i < seriesPy.length; i++) {
    const py = seriesPy[i];
    if (py == null || Number.isNaN(py)) continue;
    const d = Math.abs(py - cursorPy);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best != null && bestD <= maxDist ? best : null;
}
