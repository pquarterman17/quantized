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
import type { AxisFormat, AxisScale, DataStruct } from "../types";
import type { ErrorPair } from "../api";

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
  y2_step?: number | null;
  /** Categorical column that splits every `y_keys` channel into one series
   *  per group level (GUI_INTERACTION #12 Slice 5 -- the Graph Builder
   *  "group" zone's colour split; see `lib/plotspec.ts`'s `buildXY`).
   *  Omit/undefined = today's behaviour, byte-identical. Every synthetic
   *  series lands on the primary axis (`buildXY` never assigns `axis: 1`),
   *  so combining this with `y2_keys` is rejected by the backend (422). */
  group_col?: number;
  fmt?: string;
  style?: string;
  dpi?: number;
  /** MAIN #35: render on a transparent canvas (Copy figure preference). */
  transparent?: boolean;
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
  /** Property-panel overrides (#11): fonts/legend/ticks/spines/limits/margins. */
  overrides?: FigureOverrides | null;
  filename?: string;
}

export function exportFigure(body: FigureSpec): Promise<void> {
  return postDownload("/api/export/figure", body, `figure.${body.fmt ?? "pdf"}`);
}

/** Preview render + element hit-map (#13): PNG + per-artist pixel boxes. */
export function renderFigureHitmap(body: FigureSpec): Promise<FigureHitmap> {
  return postJSON("/api/export/figure-hitmap", body);
}

/** Render a figure and return the raw image bytes — for an in-app WYSIWYG
 *  preview (the figure builder), as opposed to exportFigure which downloads. */
export function renderFigureBlob(body: FigureSpec): Promise<Blob> {
  return postBlob("/api/export/figure", body);
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
 *  and download it (gap #29). */
export function exportCornerFigure(body: CornerFigureSpec): Promise<void> {
  return postDownload("/api/export/corner-figure", body, `corner.${body.fmt ?? "pdf"}`);
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
 *  and download it (gap #23). */
export function exportTernaryFigure(body: TernaryFigureSpec): Promise<void> {
  return postDownload("/api/export/ternary-figure", body, `ternary.${body.fmt ?? "pdf"}`);
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
 *  (matplotlib) and download it (gap #23). */
export function exportFieldFigure(body: FieldFigureSpec): Promise<void> {
  return postDownload("/api/export/field-figure", body, `field.${body.fmt ?? "pdf"}`);
}

/** One box/violin small-multiple panel (GUI_INTERACTION #12 slice 4b —
 *  StatStage's faceted export). `kind` is per-facet MODE FIDELITY: a violin
 *  facet that degraded to box ON SCREEN (its own /api/statplots/violin call
 *  failed independently of its sibling facets) carries `kind: "box"` so the
 *  export shows the SAME degrade rather than a fresh recompute; omitted
 *  falls back to the request's own top-level `kind`. */
export interface StatplotFacetSpec {
  label: string;
  kind?: "box" | "violin";
  data: number[][];
  labels?: string[] | null;
}

/** A statistical-plot export request (StatStage's "Export figure" button):
 *  `data` is a list of groups for box/violin, or one flat sample for
 *  qq/histogram — the SAME raw values the interactive stats/box, /violin,
 *  /qq, /histogram calls saw, so the exported figure matches the stage.
 *  `facets` (optional) renders a faceted box/violin small-multiples grid
 *  instead of the flat single panel — `data`/`labels` above are still
 *  required by the wire shape but unused server-side in that case. */
export interface StatplotFigureSpec {
  kind: "box" | "violin" | "qq" | "probability" | "histogram" | "strip";
  data: number[][] | number[];
  labels?: string[] | null;
  fmt?: string;
  style?: string;
  dist?: string;
  bins?: string | number;
  fit?: string | null;
  title?: string;
  x_label?: string;
  y_label?: string;
  dpi?: number;
  filename?: string;
  facets?: StatplotFacetSpec[] | null;
  // JMP_GAP J5: box/strip mark completion. `show_points` scatters each
  // group's raw finite values jittered with the SAME deterministic
  // (rowIndex, category) hash (lib/jitter.ts) the interactive canvas uses;
  // `point_row_indices` (parallel to `data`) supplies each group's ORIGINAL
  // dataset row indices so the export matches the screen. `show_mean_ci`
  // overlays a mean +/- 95% CI diamond+whisker marker.
  show_points?: boolean;
  point_row_indices?: number[][] | null;
  show_mean_ci?: boolean;
  // JMP_GAP J5 residual: connect-group-means "interaction plot" line
  // (box/strip only) through each group's mean, in on-screen category order.
  show_connect_means?: boolean;
}

/** Render a statistical plot (box/violin/Q-Q/histogram) server-side
 *  (matplotlib) and download it (gap #16). */
export function exportStatplotFigure(body: StatplotFigureSpec): Promise<void> {
  return postDownload("/api/export/statplot-figure", body, `statplot.${body.fmt ?? "pdf"}`);
}

// ── Categorical (bar/column) plots — gap #20 ────────────────────────────────
// Same category x series matrix the interactive stat stage's "bar" mode
// computes locally (lib/barlayout.buildBarMatrix): `values[group][series]` is
// the mean, `errors[group][series]` the SEM (null = no error bar for that
// cell), so the exported figure matches the on-screen bars exactly.

/** One bar-chart small-multiple panel (GUI_INTERACTION #12 slice 4b —
 *  StatStage bar mode's faceted export). Self-contained (own `groups`): a
 *  facet-column level can be absent from one slice, so panels never share
 *  one category set. */
export interface CategoricalFacetSpec {
  label: string;
  groups: string[];
  series: string[];
  values: number[][];
  errors: (number | null)[][];
}

/** A grouped/stacked bar-chart export request (StatStage bar mode's "Export
 *  figure" button). `facets` (optional) renders a faceted small-multiples
 *  grid instead of the flat single panel — `groups`/`series`/`values` above
 *  are still required by the wire shape but unused server-side in that case. */
export interface CategoricalFigureSpec {
  groups: string[]; // category tick labels, in axis order
  series: string[]; // series (legend) labels, in stack/cluster order
  values: number[][]; // [group][series] bar height (mean)
  errors: (number | null)[][]; // [group][series] SEM (null = no whisker)
  stacked?: boolean;
  fmt?: string;
  style?: string;
  title?: string;
  x_label?: string;
  y_label?: string;
  dpi?: number;
  filename?: string;
  facets?: CategoricalFacetSpec[] | null;
}

/** Render a grouped/stacked bar chart server-side (matplotlib) and download
 *  it (gap #20). */
export function exportCategoricalFigure(body: CategoricalFigureSpec): Promise<void> {
  return postDownload("/api/export/categorical-figure", body, `bar.${body.fmt ?? "pdf"}`);
}
