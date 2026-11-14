// What a double-click inside the plot area does (gap audit 2 #8): on a curve
// it opens that curve's Plot Details (Origin's habit: double-click whatever
// you want to format); on empty plot area it re-fits the view, which is what
// uPlot's own double-click did before. Loaded on demand from
// `usePlotStageActions`, which holds the click back from uPlot until this
// decides. Double-clicking an AXIS is not routed here: it still opens the Axis
// dialog (`AxisDropZones`).

import type uPlot from "uplot";

import { openFigureDialog } from "../../store/figureDialogs";
import { hitTest } from "./curveHit";

/** How close (CSS px, vertically at the nearest row) a double-click must land
 *  to a curve to pick it — tighter than the right-click menu's 44 px, since a
 *  miss here re-fits the view rather than just leaving a header off a menu. */
export const CURVE_DBLCLICK_PX = 12;

export function plotDoubleClick(
  u: uPlot,
  clientX: number,
  clientY: number,
  plotted: readonly number[],
  resetView: () => void,
): void {
  const hidden = plotted.map((_, i) => u.series[i + 1]?.show === false);
  const { series } = hitTest(u, clientX, clientY, plotted, hidden, false, CURVE_DBLCLICK_PX);
  if (series != null && series < plotted.length) openFigureDialog({ kind: "plotDetails", channel: plotted[series] });
  else resetView();
}
