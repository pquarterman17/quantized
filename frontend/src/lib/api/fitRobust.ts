// /api/fitting robust + quantile fits (routes/fitting_robust.py, GAP_AUDIT_9
// G11). Curve Fit's lazy Robust section only; none of it is eager.
// Responses are plain calc dicts (non-finite values arrive as null).

import { postJSON } from "./http";
import type { components } from "./schema";

type Num = number | null;

export type RobustFitRequest = components["schemas"]["RobustFitRequest"];
export type QuantileFitRequest = components["schemas"]["QuantileFitRequest"];

export interface RobustFitResult {
  /** Nonlinear fits: model parameters. Polynomial fits: coefficients, lowest power first. */
  params?: Num[];
  coefficients?: Num[];
  errors: Num[];
  paramNames?: string[];
  yFit: Num[];
  residuals: Num[];
  robustWeights: Num[];
  /** Indices (into the posted points) with robust weight < 0.5. */
  outliers: number[];
  loss?: string;
  fScale?: number;
  fScaleAuto?: boolean;
  /** Plain least-squares estimate from the same data, to show the outliers' pull. */
  lsParams?: Num[];
  olsCoefficients?: Num[];
  scale?: number;
  converged?: boolean;
  nPoints: number;
}

export function robustFit(req: RobustFitRequest, signal?: AbortSignal): Promise<RobustFitResult> {
  return postJSON("/api/fitting/robust-fit", req, signal);
}

export interface QuantileFitResult {
  coefficients: Num[];
  errors: Num[];
  yFit: Num[];
  residuals: Num[];
  tau: number;
  degree: number;
  checkLoss: Num;
  pseudoR2: Num;
  nPoints: number;
}

export function quantileFit(req: QuantileFitRequest, signal?: AbortSignal): Promise<QuantileFitResult> {
  return postJSON("/api/fitting/quantile-fit", req, signal);
}
