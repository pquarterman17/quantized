// Which curve (and which axis zone) sits under a client point on the live
// plot. Shared by the right-click menu (`PlotContextMenu`) and the curve
// double-click (`curveDoubleClick`, gap audit 2 #8); both load on demand, and
// so does this module (`lib/plotHitTest` stays off the eager path).

import type uPlot from "uplot";

import type { PlotPayload } from "../../lib/plotdata";
import { axisZoneAt, type AxisZone, nearestIndex, pickNearestSeries } from "../../lib/plotHitTest";
import { isDataSeries, nearestPointRow } from "../../lib/plotPointMask";
import { waterfallSourceRows } from "../../lib/waterfallOffset";

/** A data point this close (px) to a right-click is "the point under it". */
const POINT_PX = 8;

/** The DATASET row of the data point (a plotted or masked one, never an
 *  overlay) under the client point, or null (gap audit 3 N2). */
export function pointNear(u: uPlot | null, x: number, y: number, payload: PlotPayload, nBase: number): number | null {
  if (!u?.over) return null;
  const rect = u.over.getBoundingClientRect();
  const xs = (u.data[0] ?? []) as (number | null)[];
  const hit = nearestPointRow(
    payload.series.length,
    xs.length,
    (s) => isDataSeries(payload.series, nBase, s),
    (s, r) => {
      const xv = xs[r];
      const yv = (u.data[s + 1] as (number | null)[] | undefined)?.[r];
      if (xv == null || yv == null || !Number.isFinite(xv) || !Number.isFinite(yv)) return null;
      return [u.valToPos(xv, "x", false), u.valToPos(yv, u.series[s + 1]?.scale ?? "y", false)];
    },
    x - rect.left,
    y - rect.top,
    POINT_PX,
  );
  return hit ? (waterfallSourceRows(payload, [hit.row])[0] ?? null) : null;
}

/** Hit-test the cursor against the live plot: the nearest visible curve
 *  (within `hitPx`), which axis zone the cursor sits in, and the cursor's own
 *  DATA coordinates (computed here, ONCE, alongside the same rect/posToVal
 *  this function already needs — see PlotContextMenu's `addTextHere` for why
 *  nothing may redo this conversion later). */
export function hitTest(
  u: uPlot | null,
  x: number,
  y: number,
  plotted: readonly number[],
  hidden: readonly boolean[] | undefined,
  hasY2: boolean,
  hitPx: number,
): { series: number | null; idx: number | null; zone: AxisZone; dataX: number | null; dataY: number | null } {
  if (!u || !u.over) return { series: null, idx: null, zone: "outside", dataX: null, dataY: null };
  const rect = u.over.getBoundingClientRect();
  const zone = axisZoneAt(
    x,
    y,
    { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
    hasY2,
  );
  const localX = x - rect.left;
  const localY = y - rect.top;
  const dataX = u.posToVal(localX, "x");
  const dataY = u.posToVal(localY, "y");
  const xData = (u.data[0] ?? []) as (number | null)[];
  const idx = nearestIndex(xData, dataX);
  if (idx == null) return { series: null, idx: null, zone, dataX, dataY };
  // Pixel-y of each visible display-series at the probe index (through its own
  // scale, so primary + secondary series compare fairly). Hidden → null.
  const seriesPy: (number | null)[] = plotted.map((_, i) => {
    if (hidden?.[i]) return null;
    const col = u.data[i + 1] as (number | null)[] | undefined;
    const yv = col?.[idx];
    if (yv == null || Number.isNaN(yv)) return null;
    const scale = u.series[i + 1]?.scale ?? "y";
    return u.valToPos(yv, scale, false);
  });
  return { series: pickNearestSeries(localY, seriesPy, hitPx), idx, zone, dataX, dataY };
}
