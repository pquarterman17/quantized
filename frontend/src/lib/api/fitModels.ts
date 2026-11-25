// /api/fitting piecewise, convolution and ODE fits (routes/fitting_models.py,
// GAP_AUDIT_9 G11). Curve Fit's lazy "Piecewise, convolution and ODE fit"
// section only; none of it is eager. Responses are plain calc dicts
// (non-finite values arrive as null).

import { postJSON } from "./http";
import type { components } from "./schema";

type Num = number | null;

export type PiecewiseFitRequest = components["schemas"]["PiecewiseFitRequest"];
export type ConvolutionFitRequest = components["schemas"]["ConvolutionFitRequest"];
export type OdeFitRequest = components["schemas"]["OdeFitRequest"];

interface CurveBits {
  yFit: Num[];
  residuals: Num[];
  rss: Num;
  rSquared: Num;
  nPoints: number;
}

export interface PiecewiseFitResult extends CurveBits {
  breakpoints: { value: Num; se: Num; fixed: boolean; slopeChange: Num }[];
  slopes: { slope: Num; se: Num; xStart: number; xEnd: number }[];
  intercept: Num;
  interceptSe: Num;
  sigma: Num;
  dof: number;
}

export interface ConvolutionFitResult extends CurveBits {
  params: Num[];
  errors: Num[];
  paramNames: string[];
  fitSigma: boolean;
  instrumentSigma: Num;
  success: boolean;
  message: string;
}

export interface OdeFitResult extends CurveBits {
  model: string;
  observe: string | null;
  paramNames: string[];
  params: Num[];
  errors: Num[];
  held: string[];
  success: boolean;
  message: string;
}

export const piecewiseFit = (req: PiecewiseFitRequest, signal?: AbortSignal): Promise<PiecewiseFitResult> =>
  postJSON("/api/fitting/piecewise-fit", req, signal);

export const convolutionFit = (req: ConvolutionFitRequest, signal?: AbortSignal): Promise<ConvolutionFitResult> =>
  postJSON("/api/fitting/convolution-fit", req, signal);

export const odeFit = (req: OdeFitRequest, signal?: AbortSignal): Promise<OdeFitResult> =>
  postJSON("/api/fitting/ode-fit", req, signal);
