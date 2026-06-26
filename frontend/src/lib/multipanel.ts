// Pure helpers for the multi-panel (stacked) plot view. Splitting one
// PlotPayload into one-series-per-panel payloads and computing panel heights are
// the testable core; the uPlot-instance wiring lives in MultiPanelStage.

import type uPlot from "uplot";

import type { PlotPayload } from "./plotdata";

/** One payload per plotted series: each keeps the shared x column + a single
 *  y-series, so each renders in its own stacked panel against the same x. */
export function splitPayload(p: PlotPayload): PlotPayload[] {
  const x = p.data[0];
  return p.series.map((s, i) => ({
    data: [x, p.data[i + 1]] as uPlot.AlignedData,
    series: [s],
    xLabel: p.xLabel,
    xUnit: p.xUnit,
  }));
}

/** Equal panel heights filling `total` px with `gap` px between panels (min 1). */
export function panelHeights(n: number, total: number, gap = 8): number[] {
  if (n <= 0) return [];
  const h = Math.max(1, Math.floor((total - (n - 1) * gap) / n));
  return new Array(n).fill(h);
}
