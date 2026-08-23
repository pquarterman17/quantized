// /api/fitting/* wrappers beyond `fitModel` (which stays in lib/api.ts —
// useApp.ts and store/recalcFits.ts need it eagerly). Split out here (R8
// bundle-diet pass, 2026-08-23; see api/reference.ts's header for why):
// every one of these is curvefit-workshop-only (lazy), but co-location with
// `fitModel` in lib/api.ts was dragging them into the eager bundle. NOT
// re-exported by lib/api.ts; the curvefit workshop imports directly from
// this path.

import { getJSON, postJSON } from "./http";
import type { CalcResult, FitModel } from "../types";

/** Registry of fit models with parameter names and defaults. */
export function listFitModels(): Promise<{ models: FitModel[] }> {
  return getJSON("/api/fitting/models");
}

/** Initial-parameter guess for a named model given (x, y). */
export function autoGuess(model: string, x: number[], y: number[]): Promise<{ p0: number[] }> {
  return postJSON("/api/fitting/autoguess", { model, x, y });
}

export interface BootstrapRequest {
  model: string;
  x: number[];
  y: number[];
  p0: number[];
  n_boot?: number;
  method?: string;
  seed?: number;
  alpha?: number;
  lower?: number[];
  upper?: number[];
  /** Opt-in (gap #29): also return the full replicate matrix as
   *  `boot_samples` ([n_kept x P]) — the corner-plot source. */
  return_samples?: boolean;
}

export interface BootstrapResult {
  params: number[];
  boot_mean: number[];
  boot_se: number[];
  ciLow: number[];
  ciHigh: number[];
  n_boot: number;
  n_failed: number;
  /** Present only when `return_samples: true` was posted. */
  boot_samples?: number[][];
  [key: string]: unknown;
}

/** Bootstrap parameter uncertainty (percentile CIs) for a named model fit;
 *  pass `return_samples: true` to also get the replicate matrix for a
 *  corner (pairs) plot — the uncertainty-quantification counterpart to
 *  `fitModel` (gap #29). */
export function bootstrapFit(req: BootstrapRequest): Promise<BootstrapResult> {
  return postJSON("/api/fitting/bootstrap", req);
}

// ── Custom equation models (GOTO #1) ────────────────────────────────────────
export interface EquationValidateResult {
  ok: boolean;
  params: string[];
  error?: string;
}

/** Validate a custom fit equation. Always 200 with ok/params/error — the
 *  live-validation shape (the fit endpoint is the one that 422s). */
export function validateEquation(equation: string): Promise<EquationValidateResult> {
  return postJSON("/api/fitting/equation/validate", { equation });
}

export interface EquationFitRequest {
  equation: string;
  x: number[];
  y: number[];
  guesses?: number[];
  /** Per-parameter bounds; null entries = unbounded on that side. */
  lower?: (number | null)[];
  upper?: (number | null)[];
  weights?: number[];
  calc_errors?: boolean;
}

/** Fit a custom equation model — the SAME result shape as `fitModel`
 *  (params/errors/R2/chiSqRed/RMSE/AIC/yFit) plus `paramNames`, so the
 *  standard fit-stats display works unchanged. */
export function fitEquation(req: EquationFitRequest): Promise<CalcResult> {
  return postJSON("/api/fitting/equation/fit", req);
}

// ── Find X from Y / Y from X on a fitted curve (MAIN #15) ──────────────────
export interface FindXYRequest {
  /** Exactly one of model / equation. */
  model?: string;
  equation?: string;
  params: number[];
  x_min: number;
  x_max: number;
  /** Exactly one of x (find Y) / y (find X, all crossings). */
  x?: number;
  y?: number;
  grid_points?: number;
}

export interface FindXYResult {
  /** Present when `x` was posted. */
  y?: number | null;
  /** Present when `y` was posted — every crossing in [x_min, x_max]; an
   *  empty array is a valid "no crossing" answer, not an error. */
  x?: number[];
}

/** Inverse-evaluate a fit already held by the UI (model/equation + fitted
 *  params) — no re-fit. Works for a registry model OR a saved custom
 *  equation, the same `fcn(x, p) -> y` shape either way. */
export function findXY(req: FindXYRequest): Promise<FindXYResult> {
  return postJSON("/api/fitting/find-xy", req);
}

// ── AICc model quick-scan (GOTO #6) ─────────────────────────────────────────
export interface ScanEquationCandidate {
  name: string;
  equation: string;
  guesses?: number[];
}

/** One ranked scan entry; a failed candidate has `error` set and null
 *  metrics (it still appears — a model that can't fit IS a scan result). */
export interface ScanEntry {
  name: string;
  kind: "registry" | "equation";
  error: string | null;
  k: number | null;
  params: number[] | null;
  paramNames: string[] | null;
  R2: number | null;
  RMSE: number | null;
  AIC: number | null;
  AICc: number | null;
  deltaAICc: number | null;
  weight: number | null;
}

export interface ScanResponse {
  n: number;
  nCandidates: number;
  results: ScanEntry[];
}

/** Fit all candidate models to (x, y) and rank by AICc. Omit `models` for
 *  the backend's default registry set (param count < n/3); saved custom
 *  equation models ride along in `equations`. */
export function scanFitModels(req: {
  x: number[];
  y: number[];
  dy?: number[];
  models?: string[];
  equations?: ScanEquationCandidate[];
}): Promise<ScanResponse> {
  return postJSON("/api/fitting/scan", req);
}
