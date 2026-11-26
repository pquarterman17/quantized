// The Stat Stage's statistical-plot and bar-chart export requests
// (`routes/export_statplots`), split out of `figures.ts` (its 500-line module
// ceiling). `figures.ts` re-exports everything here, so no importer changed.

import type { ComparisonMarks } from "../statComparisons";
import { postDownload } from "./http";

/** One box/violin small-multiple panel (GUI_INTERACTION #12 slice 4b —
 *  StatStage's faceted export). `kind` is per-facet MODE FIDELITY: a violin
 *  facet that degraded to box ON SCREEN (its own /api/statplots/violin call
 *  failed independently of its sibling facets) carries `kind: "box"` so the
 *  export shows the SAME degrade rather than a fresh recompute; omitted
 *  falls back to the request's own top-level `kind`. */
export interface StatplotFacetSpec {
  label: string;
  kind?: "box" | "violin" | "strip";
  data: number[][];
  labels?: string[] | null;
  /** Review finding 2: this panel's own canvas y-domain (box only — see
   *  `StatplotFigureSpec.y_domain`'s doc), each panel autoscaling
   *  independently as it already does on screen. */
  y_domain?: [number, number] | null;
  /** Review finding 4: this panel's OWN [outer, inner] pairs, one per
   *  `labels` entry — a nested axis's pairs are per-panel data (each
   *  panel's own composite labels), so they never ride the request's
   *  SHARED top-level `axis_style.tiers` (which has no single panel's
   *  labels to describe). Null/absent outside a nested plot. */
  tiers?: [string, string][] | null;
  /** JMP_GAP J5 residual: this panel's groups' ORIGINAL rows, parallel to
   *  `data` — its jittered points hash the screen's `(row, category)`.
   *  Absent: the panel draws no jittered points. */
  point_row_indices?: number[][] | null;
  /** Where this panel's connect-means line lifts (a hidden empty level sat
   *  before that group), as the flat request's `connect_breaks`. */
  connect_breaks?: boolean[] | null;
  /** P1.4 Color-by: each group's colour level (null: by position), with the
   *  request's `palette` (lib/statColor). */
  color_levels?: (number | null)[] | null;
}

/** A statistical-plot export request (StatStage's "Export figure" button):
 *  `data` is a list of groups for box/violin, or one flat sample for
 *  qq/histogram — the SAME raw values the interactive stats/box, /violin,
 *  /qq, /histogram calls saw, so the exported figure matches the stage.
 *  `facets` (optional) renders a faceted box/violin small-multiples grid
 *  instead of the flat single panel — `data`/`labels` above are still
 *  required by the wire shape but unused server-side in that case. */
export interface StatplotFigureSpec {
  kind: "box" | "violin" | "qq" | "probability" | "histogram" | "strip" | "cdf";
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
  // P2.6 box 2 (calc.figure_group_notes): an EMPTY group in `data` keeps its
  // slot with an n=0 marker; `show_n` adds each group's n on a top axis;
  // `caveat` (lib/groupAxis.balanceCaveat) becomes a figure footnote.
  show_n?: boolean;
  caveat?: string | null;
  // P2.6 box 1: which error bar the figure draws ("Error bars: SE of the
  // mean", lib/statMarks.errorBarNote) -- a footnote line above the caveat.
  error_note?: string | null;
  // Significance brackets / compact letters, laid out (lib/statComparisons
  // `ComparisonMarks`; calc.figure_stat_comparisons draws them).
  comparisons?: ComparisonMarks | null;
  // P2.6 box 1 (calc.figure_stat_marks / calc.figure_category_axis): raw
  // points, jitter width, summary marker, error bars, label options.
  points?: "all" | "outliers" | "none" | null;
  jitter_width?: number | null;
  summary?: "none" | "mean" | "median" | null;
  error_bars?: "none" | "sd" | "se" | "ci95" | null;
  axis_style?: CategoryAxisStyleWire | null;
  /** Per group: the connect-means line lifts BEFORE it (a hidden empty level
   *  sat there). Absent = only empty groups and nested boundaries break it. */
  connect_breaks?: boolean[] | null;
  /** Review finding 2 (P2.6 review): the canvas's own value-axis range
   *  (`Stage/statStageExport.canvasYDomain`) for `kind: "box"` / `"strip"`.
   *  The canvas's domain intentionally spans every raw datum (fliers, hidden
   *  points) so toggling a mark never rescales the plot; matplotlib instead
   *  autoscales to whatever it actually drew, which narrows whenever a mark
   *  is hidden (e.g. `points: "none"`). Sending the canvas's exact range as
   *  an explicit y-limit (`ax.set_ylim`) makes the two agree exactly rather
   *  than reconciling two different autoscale rules. `null`/absent = no
   *  forced limit (today's autoscale-to-drawn-artists behaviour); violin has
   *  no such divergence (its domain is the KDE curve's own extent). */
  y_domain?: [number, number] | null;
  /** P1.4 Color-by (lib/statColor): each group's colour LEVEL, aligned with
   *  `data` (null: by position), and the palette as hex, indexed by level. */
  color_levels?: (number | null)[] | null;
  palette?: string[] | null;
  /** Item 20: `kind: "cdf"` (`data` = one list per column) takes Y as a
   *  proportion or count and the DKW band; a fitted CDF rides `fit`. */
  cdf?: { y: "proportion" | "count"; band: boolean } | null;
  /** Item 20: rug ticks along X (histogram / cdf); length is axes-fraction. */
  rug?: { length: number; opacity: number } | null;
}

/** P2.6 box 1: the category-axis label options (routes/export_statplots.
 *  CategoryAxisStyle) — rotation, wrap width in characters, two-tier nested
 *  axis. Built by `lib/statMarks.axisStyleWire` from the screen's options. */
export interface CategoryAxisStyleWire {
  rotation: 0 | 45 | 90;
  wrap: number | null;
  tiered: boolean;
  /** "auto": the figure applies the wrap-or-rotate rule in its own geometry
   *  (`calc.figure_category_axis.fit_category_labels`). */
  fit?: "auto" | null;
}

/** Render a statistical plot (box/violin/Q-Q/histogram) server-side
 *  (matplotlib) and download it (gap #16). `signal`: see exportFigure. */
export function exportStatplotFigure(body: StatplotFigureSpec, signal?: AbortSignal): Promise<void> {
  return postDownload("/api/export/statplot-figure", body, `statplot.${body.fmt ?? "pdf"}`, signal);
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
  values: (number | null)[][];
  errors: (number | null)[][];
  /** P2.6 box 2: [group][series] n -> an n=K label over each grouped bar. */
  counts?: number[][] | null;
  /** JMP_GAP J5 residual: this panel's grouped-bar points / summary marker
   *  (the flat request's `points` .. `raw_rows`, over this panel's cells). */
  points?: "all" | "outliers" | "none" | null;
  jitter_width?: number | null;
  summary?: "none" | "mean" | "median" | null;
  raw?: number[][][] | null;
  raw_rows?: number[][][] | null;
  /** P1.4 Color-by: each category's colour level, with the request's `palette`. */
  color_levels?: (number | null)[] | null;
}

/** A grouped/stacked bar-chart export request (StatStage bar mode's "Export
 *  figure" button). `facets` (optional) renders a faceted small-multiples
 *  grid instead of the flat single panel — `groups`/`series`/`values` above
 *  are still required by the wire shape but unused server-side in that case. */
export interface CategoricalFigureSpec {
  groups: string[]; // category tick labels, in axis order
  series: string[]; // series (legend) labels, in stack/cluster order
  values: (number | null)[][]; // [group][series] bar height (mean); null = no data (P2.6 box 2)
  errors: (number | null)[][]; // [group][series] error half-width: SEM, or SD / 95% CI (P2.6 box 1); null = no whisker
  counts?: number[][] | null; // P2.6 box 2: [group][series] n labels (grouped bars)
  caveat?: string | null; // P2.6 box 2: lib/groupAxis.balanceCaveat, as a footnote
  error_note?: string | null; // P2.6 box 1: lib/statMarks.errorBarNote, footnote line above it
  comparisons?: ComparisonMarks | null; // significance brackets / letters, laid out
  axis_style?: CategoryAxisStyleWire | null; // P2.6 box 1: label rotation / wrap
  stacked?: boolean; y_domain?: [number, number] | null; // y_domain: a fixed value-axis range (an Origin layer's Y)
  fmt?: string;
  style?: string;
  title?: string;
  x_label?: string;
  y_label?: string;
  dpi?: number;
  filename?: string;
  facets?: CategoricalFacetSpec[] | null;
  // P2.6 box 1 (calc.figure_stat_marks.overlay_bar_marks), grouped bars of the
  // flat panel: raw points / jitter / summary marker; `raw[group][series]` the
  // cell's finite values, `raw_rows` their original rows (the jitter's hash).
  points?: "all" | "outliers" | "none" | null;
  jitter_width?: number | null;
  summary?: "none" | "mean" | "median" | null;
  raw?: number[][][] | null;
  raw_rows?: number[][][] | null;
  /** P1.4 Color-by (lib/statColor): each category's colour LEVEL (every
   *  series of it; null: by series), and the palette as hex. */
  color_levels?: (number | null)[] | null;
  palette?: string[] | null;
}

/** Render a grouped/stacked bar chart server-side (matplotlib) and download
 *  it (gap #20). `signal`: see exportFigure. */
export function exportCategoricalFigure(body: CategoricalFigureSpec, signal?: AbortSignal): Promise<void> {
  return postDownload("/api/export/categorical-figure", body, `bar.${body.fmt ?? "pdf"}`, signal);
}
