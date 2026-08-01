// Stats endpoint wrappers — the `/api/stats/*` half of the typed backend
// client. Extracted from `lib/api.ts` (2026-07-29, JMP_GAP #14): that file
// reached 2,282 lines with no ratchet guard on it, and the JMP campaign is
// the reason it grew (outliers J9, PCA/correlation J10, distribution depth
// J12 all landed here). NEW STATS WRAPPERS GO IN THIS FILE, not api.ts —
// J8's variability-chart UI wrappers (`/api/stats/{nested-anova,
// variance-components,variability-summary}`) are the next ones due.
//
// Re-exported by `lib/api.ts`, so all 21 consumers (and the `vi.mock`s in
// their tests) keep importing from `./lib/api` unchanged. Module resolution
// note: `./lib/api` resolves to the FILE `api.ts`, never this directory —
// file beats directory in both tsc and Vite.

import { postJSON } from "./http";
import type { CalcResult } from "../types";

// ── Stats ───────────────────────────────────────────────────────────────────
export function statsDescriptive(x: number[]): Promise<CalcResult> {
  return postJSON("/api/stats/descriptive", { x });
}

/** Histogram with a data-driven bin rule (`fd`/`sturges`/`scott`/…/int) and an
 *  optional distribution-fit overlay (scipy dist name). */
export function statsHistogram(
  data: number[],
  bins: string | number = "fd",
  fit?: string | null,
): Promise<CalcResult> {
  return postJSON("/api/statplots/histogram", { data, bins, ...(fit ? { fit } : {}) });
}

/** Shapiro-Wilk normality test (valid 3 ≤ n ≤ 5000). Returns W, p, N. */
export function statsShapiro(x: number[]): Promise<CalcResult> {
  return postJSON("/api/stats/shapiro", { x });
}

/** One family's MLE fit from /api/stats/fit-distribution — params, log-
 *  likelihood, AIC, and a KS goodness-of-fit test against the fitted curve. */
export interface DistFitResult {
  dist: string;
  params: Record<string, number>;
  loglike: number;
  aic: number;
  n_params: number;
  ks_d: number;
  ks_p: number;
  ks_p_approximate: boolean;
  N: number;
}

export interface DistFitAllResponse {
  fits: DistFitResult[];
  best: string;
  skipped: { dist: string; reason: string }[];
}

/** MLE-fit every curated family (ORIGIN_GAP #28: normal/lognormal/weibull/
 *  gamma/exponential), ranked by AIC ascending (`fits[0]` = `best`).
 *  Families whose support the data violates come back in `skipped`, not
 *  silently dropped. The Distribution workshop's fit-overlay picker (#52
 *  item 6b) — its first frontend consumer. */
export function statsFitDistributions(x: number[]): Promise<DistFitAllResponse> {
  return postJSON("/api/stats/fit-distribution", { x });
}

// ── Outlier screening (JMP_GAP J9) — Grubbs / Rosner / Dixon Q / MAD ───────
// Same request/response shapes as calc.stats_outliers.*; every `flagged_indices`
// (and `index`, for the single-outlier tests) is an index into the ARRAY SENT
// AS `x` -- the outlier-screening workshop always sends the ANALYSIS view's
// pruned column (rowstate.analysisData), so those indices are pruned-row
// positions the caller maps to ORIGINAL row indices via
// rowstate.activeRowIndices (the same technique the Distribution workshop's
// histogram-bin brushing uses).

export interface OutlierGrubbsResult {
  G: number;
  G_critical: number;
  flagged: boolean;
  flagged_indices: number[];
  index: number;
  value: number;
  tail: string;
  alpha: number;
  N: number;
  excluded_indices: number[];
  method: string;
}

/** Grubbs' test for a single outlier. */
export function statsGrubbs(
  x: number[],
  alpha = 0.05,
  tail: "two-sided" | "less" | "greater" = "two-sided",
): Promise<OutlierGrubbsResult> {
  return postJSON("/api/stats/grubbs", { x, alpha, tail });
}

export interface OutlierRosnerRow {
  i: number;
  R: number;
  lambda_critical: number;
  index: number;
  value: number;
  exceeds: boolean;
}

export interface OutlierRosnerResult {
  num_outliers: number;
  flagged_indices: number[];
  flagged_values: number[];
  table: OutlierRosnerRow[];
  k: number;
  alpha: number;
  N: number;
  excluded_indices: number[];
  method: string;
}

/** Generalized ESD test (Rosner) for up to `k` outliers. */
export function statsRosner(x: number[], k: number, alpha = 0.05): Promise<OutlierRosnerResult> {
  return postJSON("/api/stats/rosner", { x, k, alpha });
}

export interface OutlierDixonResult {
  Q: number;
  Q_critical: number;
  ratio: string;
  tail: string;
  flagged: boolean;
  flagged_indices: number[];
  index: number;
  value: number;
  alpha: number;
  N: number;
  excluded_indices: number[];
  method: string;
}

/** Dixon's Q test for a single outlier in a small sample (3 <= n <= 30). */
export function statsDixonQ(x: number[], alpha = 0.05): Promise<OutlierDixonResult> {
  return postJSON("/api/stats/dixon-q", { x, alpha });
}

export interface OutlierMadResult {
  modified_z_scores: (number | null)[];
  median: number;
  mad: number;
  scale_method: string;
  threshold: number;
  flagged_indices: number[];
  N: number;
  excluded_indices: number[];
  method: string;
}

/** Robust modified z-score (MAD-based) outlier flagging. */
export function statsMadOutliers(x: number[], threshold = 3.5): Promise<OutlierMadResult> {
  return postJSON("/api/stats/mad-outliers", { x, threshold });
}

// ── Statistical plots — box / violin / Q-Q (gap #16, the StatStage) ────────
// Same request/response shapes as calc.statplots.{grouped_box_stats,
// violin_kde, qq_plot}; the interactive canvas (Stage/statRender.ts) and the
// matplotlib export (exportStatplotFigure below) both read these numbers, so
// on-screen and exported statistics always agree.

/** One group's box-and-whisker stats (matplotlib.cbook.boxplot_stats-compatible). */
export interface BoxStatWire {
  q1: number;
  median: number;
  q3: number;
  iqr: number;
  whislo: number;
  whishi: number;
  mean: number;
  /** Standard error of the mean + 95% t-based CI bounds (JMP_GAP J5 #2) --
   *  optional for wire back-compat with older test fixtures/mocks; the live
   *  backend always sends them (`calc.statplots.box_stats`). */
  sem?: number;
  ci_lo?: number;
  ci_hi?: number;
  n: number;
  fliers: number[];
  whis: number | string;
  label: string;
}

export interface BoxStatsResponse {
  boxes: BoxStatWire[];
  n_groups: number;
}

/** Box/whisker stats for one or more groups. */
export function statsBox(
  groups: number[][],
  labels?: string[] | null,
  whis: number | string = 1.5,
): Promise<BoxStatsResponse> {
  return postJSON("/api/statplots/box", { groups, labels, whis });
}

export interface ViolinResponse {
  x: number[];
  density: number[];
  bandwidth: number;
  quartiles: [number, number, number];
  n: number;
}

/** Gaussian-KDE density for a violin plot. */
export function statsViolin(
  data: number[],
  bwMethod: string | number = "scott",
  nPoints = 128,
  cut = 2.0,
): Promise<ViolinResponse> {
  return postJSON("/api/statplots/violin", { data, bw_method: bwMethod, n_points: nPoints, cut });
}

export interface QQResponse {
  theoretical_quantiles: number[];
  sample_quantiles: number[];
  slope: number;
  intercept: number;
  r_squared: number;
  dist: string;
  n: number;
}

/** Quantile-quantile / probability-plot coordinates against a distribution. */
export function statsQQ(data: number[], dist = "norm"): Promise<QQResponse> {
  return postJSON("/api/statplots/qq", { data, dist });
}

/** Standard OLS mean-response confidence band, or (`interval:"prediction"`)
 *  a new-observation prediction band (JMP_GAP J3 residual) — one
 *  `calc.stats_band.polynomial_confidence_band` call, present on
 *  `CalcResult.band` only when the request's `band_x` was non-empty. */
export interface RegressionBand {
  x: number[];
  yFit: number[];
  ciLo: number[];
  ciHi: number[];
  alpha: number;
  interval: "confidence" | "prediction";
}

export function statsRegression(body: {
  x: number[];
  y: number[];
  order?: number;
  alpha?: number;
  // JMP_GAP J3 residual (Fit Y by X's bivariate leg): an opt-in confidence-
  // band evaluation grid. Omitted -- today's response, byte-identical; a
  // non-empty grid adds a "band" field (RegressionBand, above).
  band_x?: number[];
  // JMP_GAP J3 residual: switches the SAME band field from the mean-
  // response confidence band (default, omitted) to a new-observation
  // prediction band.
  band_interval?: "confidence" | "prediction";
}): Promise<CalcResult> {
  return postJSON("/api/stats/regression", body);
}

export function statsTTest(body: {
  x: number[];
  y?: number[];
  mu?: number;
  paired?: boolean;
  tail?: string;
}): Promise<CalcResult> {
  return postJSON("/api/stats/ttest", body);
}

export function statsAnova(groups: number[][]): Promise<CalcResult> {
  return postJSON("/api/stats/anova", { groups });
}

/** Levene / Brown-Forsythe test for equal variances across groups (default
 *  center="median" = Brown-Forsythe, the robust variant). Fit Y by X's
 *  oneway leg uses this as an equal-variance warning next to plain ANOVA. */
export function statsLevene(groups: number[][], center: string = "median"): Promise<CalcResult> {
  return postJSON("/api/stats/levene", { groups, center });
}

/** Tukey HSD all-pairs post-hoc (JMP_GAP J3 oneway leg, >2 levels). */
export function statsTukey(groups: number[][], alpha = 0.05): Promise<CalcResult> {
  return postJSON("/api/stats/tukey", { groups, alpha });
}

/** Pearson chi-square test of independence on an R x C contingency table
 *  (JMP_GAP J3 contingency leg; calc.stats_contingency.chi_square_independence). */
export function statsChiSquareIndependence(table: number[][]): Promise<CalcResult> {
  return postJSON("/api/stats/chi-square-independence", { table });
}

/** Fisher's exact test on a 2x2 contingency table (JMP_GAP J3 contingency leg,
 *  the small-expected-count alternative to chi-square). */
export function statsFisherExact(
  table: number[][],
  alternative: string = "two-sided",
): Promise<CalcResult> {
  return postJSON("/api/stats/fisher-exact", { table, alternative });
}

/** `/api/stats/pca` response — `calc.stats.pca_analysis` verbatim (coeff =
 *  loadings p×k, score = observations×k, latent = eigenvalues,
 *  explained/cumulative = percent variance). */
export interface PCAResponse {
  coeff: number[][];
  score: number[][];
  latent: number[];
  explained: number[];
  cumulative: number[];
  mu: number[];
  sigma: number[];
  singular: number[];
}

export function statsPCA(body: {
  data: number[][];
  center?: boolean;
  scale?: boolean;
  num_components?: number;
}): Promise<PCAResponse> {
  return postJSON("/api/stats/pca", body);
}

/** `/api/stats/correlation` response — `calc.stats_multivar.correlation_matrix`
 *  verbatim: pairwise `r` and its 2-tailed p-value (n×n each), the complete-row
 *  count `N` after listwise deletion, and the method actually used. */
export interface CorrelationResponse {
  r: number[][];
  p: number[][];
  N: number;
  method: string;
}

/** Pairwise Pearson/Spearman correlation matrix + significance. `columns` is
 *  column-major (one array per variable, JMP_GAP J10's multivariate
 *  workbench). */
export function statsCorrelation(
  columns: number[][],
  method: "pearson" | "spearman" = "pearson",
): Promise<CorrelationResponse> {
  return postJSON("/api/stats/correlation", { columns, method });
}

// ── Variability chart + variance components (JMP_GAP J8) ──────────────────
// calc.stats_varcomp's two-level nested (hierarchical) ANOVA. Every wrapper
// takes the SAME `groups[i][j]` shape: factor-A level i's factor-B (nested
// in A) level j's array of response observations — built client-side by
// lib/variability.buildNestedLevels/toWireGroups from two picked categorical
// columns. See calc/stats_varcomp.py for the full data contract.

export interface NestedAnovaRow {
  source: string;
  SS: number;
  df: number;
  MS: number | null;
  F: number | null;
  p: number | null;
}

export interface NestedAnovaResponse {
  table: NestedAnovaRow[];
  a_levels: number;
  b_per_a: number[];
  n_per_cell: number[][];
  n_total: number;
  grand_mean: number;
  alpha: number;
  a_tested_against: string;
  b_within_a_estimable: boolean;
  error_estimable: boolean;
  balanced: boolean;
}

/** Fully nested two-level ANOVA: A tested against B(A) (or against Error
 *  directly when B(A) isn't estimable — `a_tested_against` says which). */
export function statsNestedAnova(groups: number[][][], alpha = 0.05): Promise<NestedAnovaResponse> {
  return postJSON("/api/stats/nested-anova", { groups, alpha });
}

export interface VarianceComponentsResponse {
  sigma2_A: number;
  sigma2_B_within_A: number;
  sigma2_error: number;
  sigma2_A_raw: number;
  sigma2_B_within_A_raw: number;
  sigma2_error_raw: number;
  pct_A: number;
  pct_B_within_A: number;
  pct_error: number;
  clamped: { A: boolean; B_within_A: boolean; error: boolean };
  n1_coefficient: number;
  n2_coefficient: number;
  ms_a: number;
  ms_b: number;
  ms_e: number;
  balanced: boolean;
  method: string;
}

/** ANOVA/EMS-method variance-component estimates. Requires B(A) AND Error
 *  both estimable (422 otherwise) — callers should gate this call on a
 *  landed `NestedAnovaResponse`'s `b_within_a_estimable && error_estimable`
 *  rather than let the request round-trip to fail. */
export function statsVarianceComponents(groups: number[][][]): Promise<VarianceComponentsResponse> {
  return postJSON("/api/stats/variance-components", { groups });
}

export interface VariabilityCellSummary {
  a_index: number;
  b_index: number;
  n: number;
  mean: number;
  sd: number | null;
}

export interface VariabilityGroupSummary {
  a_index: number;
  n: number;
  mean: number;
}

export interface VariabilitySummaryResponse {
  cells: VariabilityCellSummary[];
  a_groups: VariabilityGroupSummary[];
  grand_mean: number;
  grand_n: number;
  a_levels: number;
  balanced: boolean;
}

/** Per-cell / per-A-group / grand summary stats — the variability chart's
 *  data contract (JMP_GAP_PLAN #8). */
export function statsVariabilitySummary(groups: number[][][]): Promise<VariabilitySummaryResponse> {
  return postJSON("/api/stats/variability-summary", { groups });
}
