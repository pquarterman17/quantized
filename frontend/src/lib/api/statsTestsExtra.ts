// Statistical-tests workshop wrappers, part two: the `/api/stats/*` routes for
// classification and count/categorical work that had no frontend caller (ROC /
// AUC / Youden, logistic and Poisson GLM, chi-square goodness of fit, p-value
// adjustment). Kept in its own file so api/statsTests.ts (the union and the
// dispatcher) stays small; request shapes come from the generated schema and
// the routes return plain calc dicts (non-finite values arrive as null).
// Survival (Kaplan-Meier / log-rank / Cox) is a follow-up and is not wired here.

import { postJSON } from "./http";
import type { components } from "./schema";

type S = components["schemas"];
type Num = number | null;

/** `/roc-curve`: one point per threshold, starting at (0, 0). The first
 *  threshold is +infinity, which arrives as null. */
export interface RocCurveResult {
  fpr: Num[];
  tpr: Num[];
  thresholds: Num[];
  auc: Num;
  N: number;
  nPositive: number;
  nNegative: number;
}

/** `/youden-threshold`: the cutoff that maximises TPR - FPR. */
export interface YoudenResult {
  optimalThreshold: Num;
  youdenJ: Num;
  fpr: Num;
  tpr: Num;
}

/** ROC analysis is two routes chained: the curve (with its AUC), then the
 *  Youden-optimal cutoff on it. */
export interface RocResult {
  roc: RocCurveResult;
  youden: YoudenResult;
}

export interface GlmResult {
  coeffs: Num[];
  se: Num[];
  zStats: Num[];
  pValues: Num[];
  ciLow: Num[];
  ciHigh: Num[];
  pseudoR2: Num;
  AIC: Num;
  deviance: Num;
  yPred: Num[];
  N: number;
  alpha: number;
}

export interface ChiSquareGofResult {
  chi2: Num;
  dof: number;
  p_value: Num;
  N: number;
  method: string;
}

/** `/adjust-p`, plus the p-values that were sent (the route returns only the
 *  adjusted ones; the table pairs them). */
export interface AdjustPResult {
  adjusted: Num[];
  method: string;
  m: number;
  p_values: number[];
}

export function statsRocCurve(body: S["RocRequest"], signal?: AbortSignal): Promise<RocCurveResult> {
  return postJSON("/api/stats/roc-curve", body, signal);
}

export function statsYouden(body: S["YoudenRequest"], signal?: AbortSignal): Promise<YoudenResult> {
  return postJSON("/api/stats/youden-threshold", body, signal);
}

/** ROC curve + AUC, then the Youden cutoff. The curve's anchor point (0, 0) has
 *  an infinite threshold (null on the wire, which the Youden route rejects);
 *  it is left out of the cutoff search, so a cutoff is always a real score. */
export async function statsRoc(body: S["RocRequest"], signal?: AbortSignal): Promise<RocResult> {
  const roc = await statsRocCurve(body, signal);
  const keep = roc.thresholds.map((t) => t !== null && Number.isFinite(t));
  const pick = (xs: Num[]) => xs.filter((_, i) => keep[i]) as number[];
  const youden = await statsYouden({ fpr: pick(roc.fpr), tpr: pick(roc.tpr), thresholds: pick(roc.thresholds) }, signal);
  return { roc, youden };
}

export function statsGlmLogistic(body: S["GlmRequest"], signal?: AbortSignal): Promise<GlmResult> {
  return postJSON("/api/stats/glm-logistic", body, signal);
}

export function statsGlmPoisson(body: S["GlmRequest"], signal?: AbortSignal): Promise<GlmResult> {
  return postJSON("/api/stats/glm-poisson", body, signal);
}

export function statsChiSquareGof(body: S["ChiSquareGofRequest"], signal?: AbortSignal): Promise<ChiSquareGofResult> {
  return postJSON("/api/stats/chi-square-gof", body, signal);
}

export async function statsAdjustP(body: S["AdjustPRequest"], signal?: AbortSignal): Promise<AdjustPResult> {
  const res = await postJSON<Omit<AdjustPResult, "p_values">>("/api/stats/adjust-p", body, signal);
  return { ...res, p_values: [...body.p_values] };
}
