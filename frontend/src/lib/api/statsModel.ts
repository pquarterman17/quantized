// Fit Model wrappers (GAP_AUDIT_9 G1): `/api/stats/fit-model` and its
// `/predict` evaluation route (routes/stats_model.py). Its own module, imported
// only by the lazy Fit Model workshop (and later the G7 profiler), so none of
// it reaches the eager bundle through `lib/api.ts`'s barrel.
//
// The response types are written out here because the route returns a plain
// dict (calc/stats_linear_model.py `fit_linear_model` documents every key).

import { postJSON } from "./http";

export type FitModelFactorKind = "continuous" | "nominal";

export interface FitModelFactorBody {
  name: string;
  kind: FitModelFactorKind;
  /** continuous: numbers (null = missing); nominal: level labels (null = missing). */
  values: (number | string | null)[];
  /** nominal: level order; the last level is the one coded -1. */
  levels?: string[];
}

export interface FitModelBody {
  response_name: string;
  response: (number | null)[];
  factors: FitModelFactorBody[];
  /** Factor-name lists: ["A"], ["A","B"] (crossed), ["X","X"] (quadratic). */
  terms: string[][];
  center_polynomials: boolean;
  alpha?: number;
}

export interface FitModelAnovaRow {
  source: "Model" | "Error" | "C. Total";
  df: number;
  ss: number;
  ms: number | null;
  f: number | null;
  p: number | null;
}

export interface FitModelEstimate {
  term: string;
  estimate: number;
  se: number;
  t: number | null;
  p: number | null;
  lower: number;
  upper: number;
}

export interface FitModelEffectTest {
  effect: string;
  nparm: number;
  df: number;
  ss: number;
  f: number | null;
  p: number | null;
}

export interface FitModelLsMeansRow {
  levels: string[];
  ls_mean: number;
  se: number;
  mean: number | null;
  n: number;
}

export interface FitModelLsMeans {
  effect: string;
  factors: string[];
  rows: FitModelLsMeansRow[];
}

/** The fitted model as plain JSON: what `/fit-model/predict` evaluates. */
export interface FittedModel {
  response: string;
  factors: ({ name: string; kind: "nominal"; levels: string[] } | { name: string; kind: "continuous"; mean: number })[];
  terms: string[][];
  center_polynomials: boolean;
  parameters: string[];
  coefficients: number[];
  covariance: number[][];
  df_error: number;
  rmse: number;
}

export interface FitModelResponse {
  response: string;
  n: number;
  n_dropped_missing: number;
  summary: { r2: number | null; adj_r2: number | null; rmse: number; mean_response: number; n: number };
  anova: FitModelAnovaRow[];
  parameter_estimates: FitModelEstimate[];
  effect_tests: FitModelEffectTest[];
  ls_means: FitModelLsMeans[];
  /** Per request row (null = dropped for a missing value). */
  predicted: (number | null)[];
  residual: (number | null)[];
  alpha: number;
  center_polynomials: boolean;
  model: FittedModel;
}

export interface FitModelPrediction {
  predicted: number[];
  se_mean: number[];
  df_error: number;
  rmse: number;
}

export function statsFitModel(body: FitModelBody, signal?: AbortSignal): Promise<FitModelResponse> {
  return postJSON("/api/stats/fit-model", body, signal);
}

/** Evaluate a fitted model at new settings (nominal: a fitted level label, or
 *  null for "averaged over levels"). The G7 profiler's evaluation surface. */
export function statsFitModelPredict(
  model: FittedModel,
  settings: Record<string, (number | string | null)[]>,
): Promise<FitModelPrediction> {
  return postJSON("/api/stats/fit-model/predict", { model, settings });
}
