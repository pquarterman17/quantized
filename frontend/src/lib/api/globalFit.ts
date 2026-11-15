// /api/fitting/global/job client (routes/fitting_global.py): one model fit to
// several datasets with shared parameters (calc.global_curve_fit, the port of
// MATLAB fitting.globalCurveFit), queued on the poll-model job runner — poll
// with lib/jobs (pollJob/cancelJob). Only the Curve Fit workshop's lazy
// Global fit section imports this module. The request shape comes from the
// generated OpenAPI schema; the result is the calc dict, mirrored here
// (non-finite values arrive as null).

import { postJSON } from "./http";
import type { JobSubmitResponse } from "../jobs";
import type { components } from "./schema";

type Num = number | null;

export type GlobalFitRequest = components["schemas"]["GlobalFitRequest"];

/** One sharing group as fitted: parameter `paramIdx` holds `value` across
 *  `datasets` (0-based, in request order). */
export interface GlobalShared {
  name: string;
  paramIdx: number;
  datasets: number[];
  value: Num;
  error: Num;
}

export interface GlobalFitResult {
  paramNames: string[];
  /** Per dataset (request order): the full parameter vector and its errors;
   *  a shared parameter repeats the group's value in every member row. */
  params: Num[][];
  errors: Num[][];
  shared: GlobalShared[];
  /** Per dataset: the fitted curve at that dataset's x. */
  yFit: Num[][];
  R2: Num[];
  /** Per dataset: UNWEIGHTED root-mean-square residual, in the units of y. */
  RMSE: Num[];
  /** Per dataset: the weighted sum of squares the fit minimised. */
  chiSq?: Num[];
  chiSqRed: Num;
  nTotal: number;
  nFree: number;
  /** 1 = the simplex converged; 0 = it hit the iteration limit or stalled. */
  exitFlag: number;
  /** Why exitFlag is 0, when the fitter can say (e.g. a stalled parameter). */
  warnings?: string[];
}

/** Queue a global fit; answers { job_id } at once. */
export function globalFitJob(req: GlobalFitRequest): Promise<JobSubmitResponse> {
  return postJSON("/api/fitting/global/job", req);
}

/** One model's summary in a dataset comparison: weighted residual SS, point
 *  and free-parameter counts, residual dof and information criteria. */
export interface CompareFitStats {
  rss: Num;
  n: number;
  nParams: number;
  df: number;
  aic: Num;
  aicc: Num;
  bic: Num;
}

/** POST /api/fitting/compare-datasets result (calc.dataset_compare): the
 *  extra-sum-of-squares F-test of "these parameters share one value across
 *  every dataset" (shared) against "each dataset has its own" (separate). */
export interface DatasetCompareResult {
  test: { F: Num; dfNum: number; dfDen: number; p: Num };
  shared: CompareFitStats;
  separate: CompareFitStats;
  sharedParams: string[];
  conclusion: "shared" | "separate";
  paramNames: string[];
}

/** Queue a dataset comparison (same request as the global fit; the
 *  constraints are the shared-parameter hypothesis under test). */
export function compareDatasetsJob(req: GlobalFitRequest): Promise<JobSubmitResponse> {
  return postJSON("/api/fitting/compare-datasets/job", req);
}
