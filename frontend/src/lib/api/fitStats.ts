// /api/fitting fit-statistics wrappers (routes/fitting_stats.py): confidence/
// prediction bands, goodness-of-fit diagnostics, multi-model comparison and
// orthogonal distance regression. Curve Fit workshop only, and only its lazy
// sections import this module, so none of it reaches the eager bundle.
// Request shapes come from the generated OpenAPI schema; the routes return
// plain calc dicts, so the response shapes are mirrored here (non-finite
// values arrive as null).

import { postJSON } from "./http";
import type { components } from "./schema";

type Num = number | null;

export type BandsRequest = components["schemas"]["BandsRequest"];

/** `calc.fit_stats.fit_bands`: the curve plus its confidence (ci) and
 *  prediction (pi) limits on the posted grid. All null when the fit had no
 *  usable covariance. */
export interface BandsResult {
  yFit: Num[];
  ciLo: Num[];
  ciHi: Num[];
  piLo: Num[];
  piHi: Num[];
  level: number;
}

export function fitBands(req: BandsRequest, signal?: AbortSignal): Promise<BandsResult> {
  return postJSON("/api/fitting/bands", req, signal);
}

export type DiagnosticsRequest = components["schemas"]["DiagnosticsRequest"];

export interface DiagnosticsResult {
  /** `fit_compare`: R2/adjR2/aic/aicc/bic/rmse (fStat/fPvalue null here). */
  compare: { R2: Num; adjR2: Num; aic: Num; aicc: Num; bic: Num; rmse: Num; n: number; p: number };
  /** `residual_diagnostics`: normal QQ pairs, Durbin-Watson, runs test,
   *  skewness and excess kurtosis. */
  residuals: {
    qqX: Num[];
    qqY: Num[];
    durbinWatson: Num;
    runsTestZ: Num;
    runsTestP: Num;
    nRuns: Num;
    skewness: Num;
    kurtosis: Num;
  };
}

export function fitDiagnostics(req: DiagnosticsRequest, signal?: AbortSignal): Promise<DiagnosticsResult> {
  return postJSON("/api/fitting/diagnostics", req, signal);
}

export type CompareRequest = components["schemas"]["CompareRequest"];

/** One candidate of `calc.fit_model_compare.compare_models`, in input order.
 *  A failed fit carries `error` and null metrics. */
export interface CompareEntry {
  name: string;
  kind: "registry" | "equation";
  error: string | null;
  k: number | null;
  params: Num[] | null;
  paramNames: string[] | null;
  chiSqRed: Num;
  R2: Num;
  adjR2: Num;
  aic: Num;
  aicc: Num;
  bic: Num;
  rmse: Num;
  /** Nested F-test vs the reference; null for the reference itself. */
  fStat: Num;
  fPvalue: Num;
  dAIC: Num;
  dAICc: Num;
  dBIC: Num;
}

export interface CompareResult {
  n: number;
  /** The F-test baseline (fewest free parameters unless one was named). */
  reference: string | null;
  results: CompareEntry[];
}

export function compareModels(req: CompareRequest, signal?: AbortSignal): Promise<CompareResult> {
  return postJSON("/api/fitting/compare", req, signal);
}

export type OdrRequest = components["schemas"]["OdrRequest"];

/** `calc.fit_odr.odr_fit`: Deming line with jackknife standard errors. */
export interface OdrResult {
  slope: number;
  intercept: number;
  slopeErr: Num;
  interceptErr: Num;
  lambda: number;
  rss: number;
  rmse: number;
  n: number;
}

export function odrFit(req: OdrRequest, signal?: AbortSignal): Promise<OdrResult> {
  return postJSON("/api/fitting/odr", req, signal);
}
