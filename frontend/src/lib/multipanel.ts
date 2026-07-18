// Pure helpers for the multi-panel (stacked) plot view. Splitting one
// PlotPayload into one-series-per-panel payloads and computing panel heights are
// the testable core; the uPlot-instance wiring lives in MultiPanelStage.

import type uPlot from "uplot";

import type { NormalizedFrameRect } from "./originPanels";
import type { PlotPayload } from "./plotdata";
import type { Annotation, RegionShade, SeriesStyle } from "./types";

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
  /** Origin figure-entry ids represented by this native panel, primary layer
   * first and an optional frame-coincident y2 overlay second. Audit/provenance
   * only; rendering never branches on these ids. */
  sourceFigureIds?: string[];
  datasetId: string;
  xKey: number | null;
  yKeys: number[];
  xLim: [number, number];
  yLim: [number, number];
  xLog: boolean;
  yLog: boolean;
  /** `null` = Origin decoded an EXPLICITLY blank title for this layer (never
   *  synthesize one, item B); `undefined` = undecoded, derive from the data
   *  as before. See `uplotOpts.BuildOptsArgs.xAxisLabel`'s doc for the full
   *  contract. yAxisLabel keeps its plain `string | undefined` shape — item
   *  B scopes the shared-axis/title-fidelity work to x only ("keep y axes
   *  per-panel as-is"). */
  xAxisLabel?: string | null;
  yAxisLabel?: string;
  seriesStyles?: Record<number, SeriesStyle>;
  /** Per-channel legend-label overrides (Origin's decoded `legend_labels`,
   *  fix #4), same channel-index keying as `seriesStyles`. */
  seriesLabels?: Record<number, string>;
  /** Static legend metadata recovered for this panel's own Origin layer.
   *  `legendFrameXY` is the box top-left as a fraction of THIS panel's plot
   *  frame (not the page/window); absent means the position was not decoded
   *  and the renderer uses its ordinary north-east fallback. */
  legendTitle?: string;
  legendFrameXY?: [number, number];
  /** This panel's Origin Y-error pairings (value channel -> error channel),
   *  from `originFigures.figureChannelSelection`'s dataset-level
   *  `errorbars.originErrKeys` — draws whiskers via `buildErrorColumns`
   *  instead of a bare series for the error column (item A fix: the spatial
   *  multi-panel path never applied error pairing at all). */
  errKeys?: Record<number, number>;
  /** This panel's Origin-hidden channels (`errorbars.originHiddenChannels`)
   *  — paired error / secondary-X columns Origin never draws as their own
   *  curve. Unlike the single-plot path (which keeps them in an interactive
   *  legend), a spatial panel's decoded legend is read-only, so
   *  `spatialPlottedChannels` drops them outright. */
  hiddenChannels?: number[];
  /** Origin's decoded major-tick increment for this panel's OWN x/y axes
   *  (see `fixedLogAxisSplits`'s doc) — null/absent = undecoded. */
  xStep?: number | null;
  yStep?: number | null;
  /** This panel's OWN layer's floating text marks, in its own data coords
   *  (fix #5 — a multi-panel apply used to drop every layer's annotations). */
  annotations?: Annotation[];
  /** This panel's own decoded Origin rectangular bands in its data coords.
   *  Missing/empty means no proven band; renderers never synthesize one. */
  regionShades?: RegionShade[];
  /** Secondary (right) Y axis for THIS panel — set when a frame-coincident
   *  y2 overlay layer merged into it (decode-plan #36 residual: the
   *  PNR/S7/Book33 repro, where a 3-layer graph rendered as a bogus 1x3
   *  ordinal stack instead of 2 panels with the second carrying a right-Y
   *  overlay — see `originFigures.coincidentOverlayGroups`/`resolveSpatialPanels`).
   *  Mirrors the store's own single-plot double-Y apply fields
   *  (`y2Keys`/`y2Lim`/`y2Log`/`y2Step`/`y2AxisLabel`) but scoped to this one
   *  panel instead of the whole plot. Absent/null on an ordinary panel. */
  y2Keys?: number[] | null;
  y2Lim?: [number, number] | null;
  y2Log?: boolean | null;
  y2Step?: number | null;
  y2AxisLabel?: string;
  row: number;
  col: number;
  /** Trusted decoded frame within the tiled frames' bounding box. Optional so
   *  ordinal/untrusted and non-Origin producers keep the equal-grid path. */
  frameRect?: NormalizedFrameRect;
  /** Aspect ratio of the recovered frame composition that `frameRect` is
   *  normalized to. */
  layoutAspect?: number;
  /** This layer's frame normalized to the FULL Origin PAGE (not the frames'
   *  bounding box) — the "page" fit places panels by this so a wide figure's
   *  real page margins/whitespace survive (#54 Stage 2). Absent when the page
   *  size didn't decode (then "page" fit falls back to "frames"). */
  pageRect?: NormalizedFrameRect;
  /** Aspect (width/height) of the full decoded page `pageRect` is normalized to
   *  — the letterbox aspect for "page" fit when the window has no `pageSetup`
   *  override yet. */
  pageAspect?: number;
}

/** The channels a spatial panel actually plots: its `yKeys` minus any
 *  Origin-hidden ones (item A fix, PNR.opj Book14 Graph11 repro — a
 *  "Y-error"-designated column like `dSA` rendered as a spurious point+line
 *  series because the spatial multi-panel path never dropped/paired it).
 *  Unlike the single-plot path (`usePlotPayload`'s `hidden` boolean array,
 *  which keeps a hidden channel in the legend for interactive toggling), a
 *  spatial grid cell's Origin legend is static and cannot toggle it back on,
 *  so it's
 *  simplest — and matches Origin's own rendering — to drop it outright
 *  rather than fetch+hide it. Pure so the mapping is unit-testable without a
 *  dataset/store. */
export function spatialPlottedChannels(panel: Pick<SpatialPanel, "yKeys" | "hiddenChannels">): number[] {
  const hidden = panel.hiddenChannels;
  return hidden && hidden.length > 0 ? panel.yKeys.filter((ch) => !hidden.includes(ch)) : panel.yKeys;
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

/** Panel width across a ROW of `n` x-break panels (gap #21 residual) filling
 *  `width` px, with a fixed `glyphW`-px break-glyph gutter between each
 *  adjacent pair (`n - 1` of them, narrower than the plain panel `gap` so the
 *  diagonal break mark reads as a seam rather than another panel). Unlike
 *  `facetGridSize`'s sqrt-balanced grid, x-break panels always sit in ONE row
 *  left-to-right in x order (the conventional "broken axis" layout; there are
 *  usually only 2-3 segments). Never below 1px (mirrors `panelHeights`). */
export function breakPanelWidths(n: number, width: number, glyphW = 20): number[] {
  if (n <= 0) return [];
  const w = Math.max(1, Math.floor((width - (n - 1) * glyphW) / n));
  return new Array(n).fill(w);
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
