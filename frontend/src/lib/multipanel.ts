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

/** Grid dimensions for tiling `n` HOMOGENEOUS small-multiples panels (facet
 *  grid, gap #21 residual) as close to square as possible. Unlike
 *  `spatialGridSize`, a facet panel carries no real page-position — the tiling
 *  is computed here, not decoded — so this takes a plain count instead of a
 *  panel array. Same sqrt-balance `GraphPreview.tsx`'s own facet preview grid
 *  uses; kept as a small standalone helper rather than a shared import since
 *  that file is outside this module's lane. 1x1 for n<=0 (mirrors
 *  `spatialGridSize`'s empty-set fallback). */
export function facetGridSize(n: number): { rows: number; cols: number } {
  if (n <= 0) return { rows: 1, cols: 1 };
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { rows, cols };
}

/** One CSS-grid cell's pixel size filling `width`x`height` with `gap` px
 *  between cells (min 1px each dimension) — the shared math MultiPanelStage's
 *  spatial AND facet modes both compute (initial layout and on every
 *  ResizeObserver tick), pulled out once here instead of inlined 4x. */
export function cellSize(
  width: number,
  height: number,
  grid: { rows: number; cols: number },
  gap = 8,
): { cellW: number; cellH: number } {
  return {
    cellW: Math.max(1, Math.floor((width - (grid.cols - 1) * gap) / grid.cols)),
    cellH: Math.max(1, Math.floor((height - (grid.rows - 1) * gap) / grid.rows)),
  };
}

/** A uPlot `hooks.setScale` callback that propagates an x-zoom/pan on one
 *  panel to every other panel `getPlots()` returns — the sync behaviour BOTH
 *  the plain per-channel stack and the facet grid want (the x axis means the
 *  same thing in every panel either way, unlike the independent spatial
 *  mode). Guards its own re-entrant `setScale` calls with a closed-over flag
 *  (one call → N-1 `setScale` calls on the others → would otherwise loop).
 *  `getPlots` is a thunk rather than a plain array so a caller can pass a
 *  live React ref's `.current` and always read the up-to-date panel list. */
export function xZoomSyncHook(
  getPlots: () => readonly uPlot[],
): (self: uPlot, key: string) => void {
  let syncing = false;
  return (u, key) => {
    if (key !== "x" || syncing) return;
    const { min, max } = u.scales.x;
    if (min == null || max == null) return;
    syncing = true;
    for (const other of getPlots()) {
      if (other !== u) other.setScale("x", { min, max });
    }
    syncing = false;
  };
}
