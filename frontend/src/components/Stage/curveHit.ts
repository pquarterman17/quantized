// Which curve (and which axis zone) sits under a client point on the live
// plot. Shared by the right-click menu (`PlotContextMenu`) and the curve
// double-click (`curveDoubleClick`, gap audit 2 #8); both load on demand, and
// so does this module (`lib/plotHitTest` stays off the eager path).

import type uPlot from "uplot";

import type { PlotPayload } from "../../lib/plotdata";
import { axisZoneAt, type AxisZone, nearestIndex, pickNearestSeries } from "../../lib/plotHitTest";
import { linkedRowSources } from "../../lib/linkedCurves";
import { filterReason, nearestDrawn, traceRow } from "../../lib/plotPointMask";
import type { Dataset } from "../../lib/types";

/** Why the point at dataset row `row` of `ds` is hidden by a data filter (a
 *  live graph's point: its SOURCE's filter), or undefined. Masking or
 *  unmasking it would do nothing visible, so the menu says why instead. */
export function hiddenByFilter(ds: Dataset, row: number, datasets: readonly Dataset[]): string | undefined {
  let src: Dataset | undefined = ds;
  let at = row;
  if (ds.linkedCurves) {
    const p = linkedRowSources(ds.linkedCurves, datasets)[row];
    src = p ? datasets.find((d) => d.id === p.id) : undefined;
    at = p?.row ?? -1;
  }
  const why = src ? filterReason(src, at) : null;
  return why ? `hidden by ${why} — change or clear that filter to show it` : undefined;
}

/** A data point this close (px) to a right-click is "the point under it". */
const POINT_PX = 8;

/** The DATASET row of the data point (a plotted or masked one, never an
 *  overlay) under the client point, or why it can't be named exactly; null
 *  when no point is that close (gap audit 3 N2). A reduced payload's row is
 *  traced back through its row map. */
export function pointNear(
  u: uPlot | null,
  x: number,
  y: number,
  payload: PlotPayload,
  plotted: readonly number[],
  ds: Dataset | null,
  xKey: number | null,
): { row: number } | { refused: string } | null {
  if (!u?.over) return null;
  const rect = u.over.getBoundingClientRect();
  const hit = nearestDrawn(u, x - rect.left, y - rect.top, payload, plotted, POINT_PX);
  return hit ? traceRow(payload, hit.row, plotted, ds, xKey) : null;
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
  const turned = u.scales?.x?.ori === 1; // horizontal bars / Exchange X-Y: X runs up the side
  const zone = axisZoneAt(
    x,
    y,
    { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
    hasY2,
    turned,
  );
  const localX = x - rect.left;
  const localY = y - rect.top;
  const dataX = u.posToVal(turned ? localY : localX, "x");
  const dataY = u.posToVal(turned ? localX : localY, "y");
  const xData = (u.data[0] ?? []) as (number | null)[];
  const idx = nearestIndex(xData, dataX);
  // M6 (UX menus audit): a curve is only "under" a cursor INSIDE the plotting
  // rectangle. Below the X axis the probe x still lands on a data sample, so an
  // unrelated curve within the pixel tolerance used to be named (and the Y axis,
  // where no such sample exists, never was): the two axes disagreed.
  if (idx == null || zone !== "plot") return { series: null, idx: null, zone, dataX, dataY };
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
  return { series: pickNearestSeries(turned ? localX : localY, seriesPy, hitPx), idx, zone, dataX, dataY };
}
