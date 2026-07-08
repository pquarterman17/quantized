// Pure helpers for the multi-panel (stacked) plot view. Splitting one
// PlotPayload into one-series-per-panel payloads and computing panel heights are
// the testable core; the uPlot-instance wiring lives in MultiPanelStage.

import type uPlot from "uplot";

import type { PlotPayload } from "./plotdata";
import type { SeriesStyle } from "./types";

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

/** One panel of a SPATIAL multi-panel view (decode-plan #36): unlike the
 *  plain stack mode (one panel per channel of the ACTIVE dataset, see
 *  `splitPayload`), each spatial panel owns its OWN dataset + channel
 *  selection + fixed axis state, and a grid cell (`row`/`col`) placing it
 *  the way the source page arranged it (`lib/originPanels.computePanelLayout`).
 *  Built by `originFigures.resolveFigurePanels`; consumed by
 *  `components/Stage/MultiPanelStage.tsx`. Generic — not Origin-specific in
 *  shape, so a future non-Origin multi-panel source could produce the same
 *  contract. */
export interface SpatialPanel {
  datasetId: string;
  xKey: number | null;
  yKeys: number[];
  xLim: [number, number];
  yLim: [number, number];
  xLog: boolean;
  yLog: boolean;
  xAxisLabel?: string;
  yAxisLabel?: string;
  seriesStyles?: Record<number, SeriesStyle>;
  row: number;
  col: number;
}

/** Grid dimensions spanned by a set of spatial panels (1x1 for an empty or
 *  malformed set, so callers always get a usable size). */
export function spatialGridSize(panels: readonly SpatialPanel[]): { rows: number; cols: number } {
  if (panels.length === 0) return { rows: 1, cols: 1 };
  return {
    rows: Math.max(...panels.map((p) => p.row)) + 1,
    cols: Math.max(...panels.map((p) => p.col)) + 1,
  };
}
