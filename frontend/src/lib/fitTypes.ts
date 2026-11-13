// Fit recipe types: how a fit was weighted and the reproducible recipe +
// result snapshot saved on a dataset. Extracted whole from lib/types.ts
// (which re-exports them) when the statistics-version and direct-weighting
// fields took it past its module-size pin. Types only: no runtime code.

/** Fit weighting mode (Sol GUI audit — weighting connected to error columns):
 *  - `none`    — unweighted least squares (default)
 *  - `yerr`    — 1-sigma errors from the plotted Y's designated error column
 *  - `poisson` — counting statistics, dy = sqrt(max(|y|, 1))
 *  - `manual`  — a user-picked channel holding per-point sigma
 *  - `direct`  — a user-picked channel holding the WEIGHTS themselves
 *                (Origin's "Direct weighting": w is used as given)
 *  yerr/poisson/manual resolve to a `dy` vector (backend applies 1/dy^2);
 *  `direct` resolves to the request's `weights` vector. */
export type WeightMode = "none" | "yerr" | "poisson" | "manual" | "direct";

/** Reproducible weighting choice, stored in FitSpec provenance so recompute +
 *  pipeline reproduce it. `errKey` is the sigma-column channel index for `yerr`
 *  (resolved from `errKeys` at fit time) and `manual`, and the weight-column
 *  index for `direct`; absent for none/poisson. */
export interface FitWeighting {
  mode: WeightMode;
  errKey?: number;
  /** Origin's "Scale Error with sqrt(Reduced Chi-Sqr)" turned OFF: the error
   *  column is taken as absolute sigmas. Stored only when false (on is the
   *  default, and an unweighted fit always scales). */
  scaleErrors?: false;
}

/** A reproducible fit recipe + result snapshot saved on a dataset (audit P1 #3).
 *  `xKey`/`yKey` capture the channels fit at record time so a recompute
 *  reproduces the original analysis; they're absent on legacy `{model}` specs
 *  (recompute then falls back to the live plotted selection). */
export interface FitSpec {
  model: string;
  /** Plotted X channel at fit time (`null` = the dataset's `time` axis). */
  xKey?: number | null;
  /** Primary plotted Y channel that was fit. */
  yKey?: number;
  /** Weighting used at fit time; absent = unweighted (legacy + `none`). */
  weight?: FitWeighting;
  /** Fitted parameters from the last fit/recompute (result snapshot). */
  params?: number[];
  /** Compact result summary kept beside the authoritative recipe. Full
   *  fitted curves/residual arrays stay transient and are regenerated from
   *  `model` + `params` when a result is opened. Null errors represent held
   *  parameters whose uncertainty was not estimated. */
  errors?: (number | null)[];
  R2?: number;
  RMSE?: number;
  AIC?: number;
  chiSqRed?: number;
  nFree?: number;
  /** Optimizer exit flag (1 = success, 0 = did not converge). */
  exitFlag?: number;
  /** MAIN_PLAN #30 — the rest of the reproducible recipe.
   *
   *  The x-window the fit actually consumed, AFTER row exclusions and filters
   *  pruned it. Without this a recipe says which channels were fit but not
   *  which part of them, so "fit the peak" and "fit the whole scan" are
   *  indistinguishable on reopening. */
  range?: [number, number];
  /** Original worksheet row ids used by an explicit AnalysisSelection.
   * Absent means the whole current analysis view (legacy behavior). */
  rowIds?: number[];
  /** Raw row count; structural insert/delete invalidates positional `rowIds`. */
  sourceRowCount?: number;
  /** Ordered X digest; detects reorder/replace edits preserving row count. */
  rowXFingerprint?: string;
  /** Ordered digest of persistent worksheet-row identities (duplicate-X safe). */
  rowIdentityFingerprint?: string;
  /** Points the fit consumed — the cheap corroborator for `range`: same window,
   *  different count means the underlying rows changed. */
  nPoints?: number;
  /** ISO time the fit was first produced. */
  fittedAt?: string;
  /** ISO time the recalc graph last RE-ran it. Present = the numbers on screen
   *  came from a recompute over changed data, not from the original fit — the
   *  historical-vs-recomputed distinction the audit asked for. */
  recomputedAt?: string;
  /** Which corrections were active on the source when the fit ran (names only,
   *  e.g. ["smooth", "bgPoly"]). Preprocessing changes what was fit, so a
   *  recipe that omits it can look reproducible while silently not being. */
  preprocessing?: string[];
  /** Starting values actually used. Absent = the model's registry defaults, so
   *  an untouched fit records nothing and stays lean. */
  p0?: number[];
  /** Parameter bounds, `null` where unbounded — JSON has no Infinity literal,
   *  and leaning on `JSON.stringify`'s silent Infinity→null is how a bound
   *  turns into garbage on the round trip. */
  lower?: (number | null)[];
  upper?: (number | null)[];
  /** Parameters held at their start value instead of being fitted. */
  fixed?: boolean[];
  /** How the reported parameter errors were derived. `covariance` = from the
   *  fitter's covariance matrix (`calc_errors`); `none` = not computed. The
   *  audit asked for the uncertainty METHOD because "±0.02" means different
   *  things depending on where it came from. */
  uncertainty?: "covariance" | "none";
  /** Which definitions the result snapshot's statistics follow
   *  (lib/fitStatsVersion.ts). 2 = current: (JᵀWJ)⁻¹ errors, RMSE in y
   *  units, AIC with the weight term. ABSENT = a result saved before
   *  2026-11 (Hessian errors, weighted RMSE): a recompute keeps those
   *  definitions until the user runs "Update statistics". */
  statsVersion?: 2;
}
