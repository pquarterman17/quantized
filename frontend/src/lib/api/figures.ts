// /api/export/{figure,corner-figure,ternary-figure,field-figure,
// statplot-figure,categorical-figure} wrappers — split out of lib/api.ts
// (R8 bundle-diet pass, 2026-08-23; see api/reference.ts's header for why):
// co-location with eager functions elsewhere in lib/api.ts was dragging
// this whole set (FigureSpec's ~60-field interface plus these functions)
// into the eager bundle. NOT re-exported by lib/api.ts; consumers import
// directly from this path. `exportXrdCsv`/`exportHdf5`/`exportOrigin`/
// `originComStatus`/`sendToOrigin`/`exportConsolidated` stay in lib/api.ts
// (genuinely eager via commands/fileCommands.ts's File-menu registry).
//
// `exportFigure` itself is ALSO reachable eagerly, via that same File-menu
// registry (lib/exportFigureCommand.ts's "Export Figure..." command) — but
// since every function here is a thin one-line postJSON/postDownload/
// postBlob wrapper (FigureSpec's real weight is its TYPE, erased at
// compile time), Rollup's shared chunk for this whole file measures ~0.5 kB
// — negligible, unlike lib/api.ts's old calculator/stats sprawl. The split
// is still worth it: `renderFigureHitmap`/`exportCornerFigure`/
// `exportTernaryFigure`/`exportFieldFigure`/`exportStatplotFigure`/
// `exportCategoricalFigure` stay lazy-only.

import { postBlob, postDownload, postJSON } from "./http";
import type { ExportSeriesStyle } from "../exportStyles";
import type { FigureOverrides } from "../figureOverrides";
import type { FigureHitmap } from "../previewmap";
import type { ExtraYAxisWire } from "../multiYWire";
import type { AxisFormat, AxisKey, AxisLabelStyle, AxisScale, DataStruct } from "../types";
import type { ErrorPair } from "../api";
import type { components } from "./schema";

/** One xy small-multiples panel (FIGURE_AUTHORING_WORKFLOW_PLAN F4.4 --
 *  `FigureSpec.facets`'s own doc has the full contract). Mirrors
 *  `StatplotFacetSpec`/`CategoricalFacetSpec`'s "resolved facet panel"
 *  shape below. */
export interface FigureFacetSeries {
  label: string;
  y: (number | null)[];
  /** With `FigureSpec.encoding` only: the channel's legend rename (BUG-014). */
  legend?: string;
  /** FEATURE-001: the series' own CHANNEL's chosen style (one style per
   *  channel, applied in every panel), through the same wire boundary as
   *  `series_styles` (`exportStyles.toWireSeriesStyles`) under the grouped
   *  rule -- never a palette-derived colour, so the panel's own cycle colours
   *  an unstyled series on both sides. Absent = no styling. */
  style?: ExportSeriesStyle | null;
}

export interface FigureFacetSpec {
  label: string;
  x: (number | null)[];
  series: FigureFacetSeries[];
  /** P1.4 residual 3, with `FigureSpec.encoding` or `group_col`: the dataset
   *  row behind each `x` entry and the Y channel behind each series, so the
   *  route re-splits the panel by the encoding and/or group
   *  (`lib/figureSpecFacets.withFacetRows`). `rows` alone, with
   *  `excluded_rows`: a greyed unsplit panel (`lib/facetExcluded.ts`). */
  rows?: number[];
  channels?: number[];
}

/** `FigureSpec.encoding` — see `routes/export_figures_encoded.FigureEncoding`.
 *  `palette` is the colour cycle resolved to hex, `markers` the glyph cycle. */
export interface FigureEncodingSpec {
  color_col?: number;
  symbol_col?: number;
  label_col?: number;
  palette?: string[];
  markers?: string[];
  /** P1.4 residual 4: a continuous colour column (a gradient). */
  gradient_col?: number;
  /** P1.4 residual 5: text columns appended as channels n, n+1, … (by name). */
  text_columns?: string[];
}

export interface FigureSpec {
  dataset: DataStruct;
  x_key?: number | string;
  y_keys?: (number | string)[];
  x_log?: boolean;
  y_log?: boolean;
  /** Axis scale (MAIN #12: linear/log/reciprocal) — takes precedence over
   *  `x_log`/`y_log` on the backend when present; those stay as the
   *  back-compat fallback for any older caller that only sets the boolean. */
  x_scale?: AxisScale;
  y_scale?: AxisScale;
  /** Tick-label number format (MAIN #24) — omit (or `undefined`) for auto,
   *  the backend's own default formatter; see `types.ts`'s `axisFmtParam`.
   *  A screen y2 axis maps to this request's OWN `y2_fmt` field below, not
   *  `y_fmt`. */
  x_fmt?: AxisFormat;
  y_fmt?: AxisFormat;
  /** Saved major-tick increments (Origin figure apply); honored on linear axes. */
  x_step?: number | null;
  y_step?: number | null;
  /** Secondary (right) Y axis, matplotlib twinx: `y2_keys` is a SUBSET of
   *  `y_keys` (every entry must also appear in `y_keys`, else 422) naming
   *  which of the plotted channels draw against the secondary axis; the
   *  rest stay on the primary axis. Omit/empty = today's single-axis
   *  behaviour, byte-identical. `y2_label`/`y2_scale`/`y2_fmt`/`y2_step`
   *  mirror their primary-axis counterparts but apply only to the
   *  secondary axis; a fixed secondary range rides `overrides.y2_lim`
   *  (`FigureOverrides`). */
  y2_keys?: (number | string)[];
  y2_label?: string;
  y2_scale?: AxisScale;
  y2_fmt?: AxisFormat;
  y2_step?: number | null; /** The canvas' drawn increments: hints the export takes only when they fit (lib/liveTickStepsSpec.ts). */ x_step_hint?: number | null; y_step_hint?: number | null; y2_step_hint?: number | null;
  /** Y3, Y4, ... (gap audit 4 G11, lib/multiYWire.ts): each a subset of `y_keys`. */
  y_axes?: ExtraYAxisWire[];
  /** Categorical column that splits every `y_keys` channel into one series
   *  per group level (GUI_INTERACTION #12 Slice 5 -- the Graph Builder
   *  "group" zone's colour split; see `lib/plotspec.ts`'s `buildXY`).
   *  Omit/undefined = today's behaviour, byte-identical. Every synthetic
   *  series lands on the primary axis (`buildXY` never assigns `axis: 1`),
   *  so combining this with `y2_keys` is rejected by the backend (422). */
  group_col?: number;
  /** P1.4 Graph Builder Color-by / Symbol-by / legend-label source
   *  (`lib/plotEncodingExport.ts`; backend `routes/export_figures_encoded.py`).
   *  With any column set it splits the series by `group_col` + these factors
   *  and colours/marks/labels each one as the Graph Builder preview does.
   *  Omit = today's behaviour, byte-identical. */
  encoding?: FigureEncodingSpec;
  /** F4.2c (a), with `encoding` or unsplit `facets` only (else 422): rows of
   *  the FULL `dataset` the window does not draw as data. The split takes its
   *  levels over every row, as the window does, then blanks these
   *  (`calc/figure_excluded.py`); a facet panel blanks those among its `rows`
   *  (`calc/figure_facets_excluded.py`). */
  excluded_rows?: number[];
  /** With `excluded_rows`: also draw them as grey "(excluded)" companions. */
  grey_excluded?: boolean;
  /** FIGURE_AUTHORING_WORKFLOW_PLAN F4.4 (export half): one xy small-
   *  multiples panel per facet-column level -- present only when the source
   *  document/view carries a durable `facetKey` binding (`lib/figureSpec.ts`'s
   *  `buildFacetSpecs`, called from `buildFigureSpecForView`). RESOLVED here,
   *  not a bare column index: the same `label`/`x`/per-series `y` arrays
   *  `lib/facet.facetPayloads` already computed for the on-screen grid, so
   *  backend and frontend can never disagree on level ordering/binning.
   *  Renders the SAME faceted grid Stage shows (shared x-domain, independent
   *  per-panel y-autoscale, panel title = facet level label) instead of a
   *  single overlaid plot -- see `calc.figure_facets.render_facets_figure`.
   *  Mirrors `StatplotFigureSpec.facets`/`CategoricalFigureSpec.facets`'s
   *  established shape: every other field on this spec stays present but
   *  UNUSED server-side once `facets` is set (`x_key`/`y_keys`/`overrides`/
   *  `series_styles`/... are not applied to the facet-grid render path). */
  facets?: FigureFacetSpec[] | null;
  /** A polar figure (x = angle, y = radius) in the canvas' geometry — `lib/polarFigureSpec.ts`. */
  polar?: components["schemas"]["PolarFigureSpec"];
  fmt?: string;
  style?: string;
  dpi?: number;
  /** MAIN #35: render on a transparent canvas (Copy figure preference). */
  transparent?: boolean;
  /** SVG only: glyphs as path outlines instead of live `<text>`, so the SVG
   *  needs no installed font (Copy Figure's clipboard SVG — see
   *  lib/officeClipboard.ts). Omitted/`false` = editable text, the default. */
  svg_text_as_paths?: boolean;
  /** PRIMARY_SOFTWARE_AUDIT_PLAN P3.3: print-safe export -- every series'
   *  colour is overridden to a grey ramp and the dash/marker cycle is
   *  forced server-side (`calc.figure_greyscale`). Omitted/`false` = today's
   *  coloured export. An EXPORT-ONLY divergence from the canvas (the on-
   *  screen plot stays coloured either way) -- a user-chosen export
   *  transform, not a derived style, so it does not affect the P3.3 style-
   *  parity invariant `series_styles` exists to satisfy. With `facets` set,
   *  every panel's series greys alike across the grid. This SAME `FigureSpec` is
   *  also embedded per-panel in a `/api/export/figure-page` request
   *  (`PagePanelSpec.figure`, `lib/api/figurePage.ts`) -- review fix P3.3-F1
   *  threads it into `calc.figure_page.PagePanel.greyscale` there too,
   *  honored PER PANEL (a page can mix a greyscale panel next to a
   *  coloured one); it used to reach that route and silently do nothing.
   *  `/api/export/map-figure` (`MapFigureRequest` backend-side --
   *  contour/heatmap/surface/waterfall; no frontend wrapper exists yet) has
   *  NO equivalent field at all -- every kind there colours by a continuous
   *  z-value (`cmap`), the same "colour IS the plotted quantity" case this
   *  flag already leaves untouched for a `color_by` scatter, so there is no
   *  categorical palette to grey. */
  greyscale?: boolean;
  /** MAIN #36: per-plotted-series error spans, so an exported figure shows
   *  the same bars the screen does. `null` for a series with none. */
  error_spans?: ({ x?: ErrorPair; y?: ErrorPair } | null)[];
  /** Page size in inches (#54 Stage 2): overrides the style preset's figure
   *  size so a publication export matches the window's PageSetup. Omit = the
   *  preset's own size (today's behaviour). */
  width_in?: number;
  height_in?: number;
  title?: string;
  x_label?: string;
  y_label?: string;
  series_styles?: (ExportSeriesStyle | null)[];
  /** BUG-013: the waterfall view's per-plotted-series vertical offset, in Y
   *  data units, aligned to `y_keys`. RESOLVED client-side
   *  (`lib/waterfallOffset.ts` — it is a fraction of a y-range the wire cannot
   *  reconstruct) and simply added to each series by
   *  `calc.plotting.apply_waterfall_offsets`, so the
   *  exported curves stagger exactly as the canvas draws them while `dataset`
   *  keeps the true, un-shifted values. Omitted for a view with no waterfall,
   *  and for the `group_col`/`facets` shapes whose renderer cannot align a
   *  `y_keys`-keyed list. */
  waterfall_offsets?: number[];
  /** Origin's waterfall X step: per-series horizontal offset in X data units,
   *  aligned to `y_keys` and resolved the same way (`lib/waterfallOffset.ts`).
   *  The backend lays the series out one x block each
   *  (`calc.plot_waterfall_x`), as the canvas does. Same omissions. */
  waterfall_x_offsets?: number[];
  /** Per-series whole-DECADE offsets aligned to `y_keys` (audit P2.3): the backend draws
   *  series i at y · 10^k with " ×10^k" in its legend, exactly as the canvas does
   *  (`lib/logOffset.ts`). Omitted when nothing is offset, with a waterfall, and for group_col/facets. */
  log_offsets?: number[];
  analysis_overlays?: boolean[]; // per y_keys: an analysis overlay (lib/figureSpecOverlays), never in an auto Y title
  /** Property-panel overrides (#11): fonts/legend/ticks/spines/limits/margins. */
  overrides?: FigureOverrides | null;
  /** Axis-title Format (`PlotView.axisLabelStyles`); size in points (canvas px x 0.75). */
  axis_label_styles?: Partial<Record<AxisKey, AxisLabelStyle>>;
  /** The axis titles' dragged offsets (`PlotView.axisLabelOffsets`), `[dx, dy]`
   *  CSS px, x right / y DOWN, read as points. */
  axis_label_offsets?: Partial<Record<AxisKey, [number, number]>>;
  filename?: string;
}

// `exportFigure` lives in ./figureRenderInfo since it toasts the render's
// warnings (publication-figures audit #7/#11); re-exported for its importers.
export { exportFigure } from "./figureRenderInfo";

/** Preview render + element hit-map (#13): PNG + per-artist pixel boxes.
 *  Rides the dataset-handle cache (`./datasetCache`); `signal` aborts a
 *  superseded preview. */
export function renderFigureHitmap(body: FigureSpec, signal?: AbortSignal): Promise<FigureHitmap> {
  return postJSON("/api/export/figure-hitmap", body, signal);
}

/** Render a figure and return the raw image bytes — for an in-app WYSIWYG
 *  preview (the figure builder), as opposed to exportFigure which downloads.
 *  `signal` — see exportFigure. For "Copy figure", postBlob's own race guard
 *  only closes part of the cancel race: it keeps a cancelled render from ever
 *  RESOLVING this promise with a post-cancel blob. `lib/clipboard.ts`'s
 *  copyImageAsync/copySvgAsync re-check the SAME signal again, one microtask
 *  later when they build the `ClipboardItem` — that narrows the remaining
 *  gap but does not close it: a cancel landing after THAT check (the
 *  browser's own read of the value promise, or the write itself) is not
 *  observable from JS, and the clipboard write still completes (see that
 *  module's own doc, and lib/exportActive.ts's post-`fn` abort check for how
 *  that residual is reported). */
export function renderFigureBlob(body: FigureSpec, signal?: AbortSignal): Promise<Blob> {
  return postBlob("/api/export/figure", body, signal);
}

/** Posted joint-parameter samples for a corner (pairs) plot — e.g.
 *  `/api/fitting/posterior`'s `samples`, or `/api/fitting/bootstrap`'s
 *  `boot_samples` (pass `return_samples: true` to get it). Stateless: no fit
 *  is re-run server-side. */
export interface CornerFigureSpec {
  samples: number[][];
  param_names: string[];
  truths?: number[] | null;
  fmt?: string;
  style?: string;
  dpi?: number;
  bins?: string | number;
  title?: string;
  width_in?: number;
  height_in?: number;
  filename?: string;
}

/** Render a pairwise posterior/bootstrap corner plot server-side (matplotlib)
 *  and download it (gap #29). `signal`: see exportFigure. */
export function exportCornerFigure(body: CornerFigureSpec, signal?: AbortSignal): Promise<void> {
  return postDownload("/api/export/corner-figure", body, `corner.${body.fmt ?? "pdf"}`, signal);
}

/** Ternary diagram request: 3-component composition scatter plot (gap #23). */
export interface TernaryFigureSpec {
  data: number[][];
  labels?: [string, string, string];
  values?: number[] | null;
  fmt?: string;
  style?: string;
  dpi?: number;
  marker_size?: number;
  title?: string;
  filename?: string;
}

/** Render a ternary diagram (3-component scatter) server-side (matplotlib)
 *  and download it (gap #23). `signal`: see exportFigure. */
export function exportTernaryFigure(body: TernaryFigureSpec, signal?: AbortSignal): Promise<void> {
  return postDownload("/api/export/ternary-figure", body, `ternary.${body.fmt ?? "pdf"}`, signal);
}

/** Vector field plot request: quiver or streamline visualization (gap #23). */
export interface FieldFigureSpec {
  x_axis: number[];
  y_axis: number[];
  u_grid: number[][];
  v_grid: number[][];
  kind?: "quiver" | "streamline";
  fmt?: string;
  style?: string;
  dpi?: number;
  title?: string;
  x_label?: string;
  y_label?: string;
  filename?: string;
}

/** Render a vector field plot (quiver arrows or streamlines) server-side
 *  (matplotlib) and download it (gap #23). `signal`: see exportFigure. */
export function exportFieldFigure(body: FieldFigureSpec, signal?: AbortSignal): Promise<void> {
  return postDownload("/api/export/field-figure", body, `field.${body.fmt ?? "pdf"}`, signal);
}

export * from "./figuresStat";
