// /api/fitting/* wrappers beyond `fitModel` (which stays in lib/api.ts —
// useApp.ts and store/recalcFits.ts need it eagerly). Split out here (R8
// bundle-diet pass, 2026-08-23; see api/reference.ts's header for why):
// every one of these is curvefit-workshop-only (lazy), but co-location with
// `fitModel` in lib/api.ts was dragging them into the eager bundle. NOT
// re-exported by lib/api.ts; the curvefit workshop imports directly from
// this path.

import { getJSON, postJSON } from "./http";
import type { CalcResult, FitModel } from "../types";
import type { components } from "./schema";

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
 *  `fitModel` (gap #29). `signal` cancels the run (P3.4: the corner
 *  plot's Cancel); `onProgress` gets the replicate fraction. */
export async function bootstrapFit(
  req: BootstrapRequest,
  signal?: AbortSignal,
  onProgress?: (fraction: number, message: string) => void,
): Promise<BootstrapResult> {
  // A job-queue run (`POST /bootstrap/job`, the same numbers as `/bootstrap`):
  // `signal` cancels the SERVER's run, not just the wait, and an answer that
  // raced the cancel is discarded (AbortError), never returned.
  const aborted = (): DOMException => new DOMException("aborted", "AbortError");
  // The submit is not abortable on purpose: aborting it could orphan a job whose id we never saw.
  const { job_id } = await postJSON<{ job_id: string }>("/api/fitting/bootstrap/job", req);
  const jobs = await import("../jobs");
  const cancel = (): void => void jobs.cancelJob(job_id).catch(() => undefined);
  if (signal?.aborted) {
    cancel();
    throw aborted();
  }
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const result = await jobs.pollJob<BootstrapResult>(job_id, onProgress, 400);
    if (signal?.aborted) throw aborted();
    return result;
  } catch (e) {
    if (e instanceof jobs.JobCancelledError) throw aborted();
    throw e;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

// ── Custom equation models (GOTO #1) ────────────────────────────────────────
/** The validate route's typed response (`EquationValidateResponse`), taken
 *  from the generated OpenAPI schema so a renamed field fails to compile
 *  here instead of at runtime. On success: `params` plus the P2.7 before-run
 *  summary (`variable` — always "x" —, `usesX`, `functions`, `constants`, in
 *  order of first appearance). On failure: `error`, and for a syntax error
 *  `[errorStart, errorEnd)` in CODE POINTS of the submitted text (convert with
 *  lib/equationSpan before indexing a JS string). */
export type EquationValidateResult = components["schemas"]["EquationValidateResponse"];

/** Validate a custom fit equation. Always 200 with ok/params/error — the
 *  live-validation shape (the fit endpoint is the one that 422s). */
export function validateEquation(equation: string, signal?: AbortSignal): Promise<EquationValidateResult> {
  return postJSON("/api/fitting/equation/validate", { equation }, signal);
}

export interface EquationFitRequest {
  equation: string;
  x: number[];
  y: number[];
  /** Starting values; a null entry (or no list) is derived from the data
   *  by the route (calc.fit_equation_init.auto_start). */
  guesses?: (number | null)[];
  /** Per-parameter bounds; null entries = unbounded on that side. */
  lower?: (number | null)[];
  upper?: (number | null)[];
  /** Per-parameter hold flags (P2.7): a held parameter keeps its guess and
   *  reports no standard error. Omitted when nothing is held. */
  fixed?: boolean[];
  /** Instrumental weighting: 1-sigma errors -> weights 1/dy^2. */
  dy?: number[];
  /** Direct weighting: the weight column used as w as given. */
  weights?: number[];
  calc_errors?: boolean;
  /** "jtj" (Origin / scipy, default) or "hessian" (MATLAB curveFit). */
  covariance?: "jtj" | "hessian";
  /** Origin "Scale Error with sqrt(Reduced Chi-Sqr)"; default true. */
  scale_errors?: boolean;
  /** false: lean response (no `residuals`; see lib/fitResiduals.ts). */
  return_residuals?: boolean;
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
