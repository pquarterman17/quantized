// POST /api/fitting/standard-curve (routes/fitting_standard_curve.py): fit
// calibration standards, then read unknown responses off the curve with an
// interval. Used only by the Curve Fit workshop's Standard curve section (lazy).

import { postJSON } from "./http";
import type { components } from "./schema";

export type StandardCurveRequest = components["schemas"]["StandardCurveRequest"];
export type StandardCurveModel = StandardCurveRequest["model"];

/** One unknown's reading: `x` is null when the response is not on the curve (`status` says why). */
export interface StandardCurveUnknown {
  y: number;
  x: number | null;
  se: number | null;
  lower: number | null;
  upper: number | null;
  status: "ok" | "extrapolated" | "outside curve" | "ambiguous";
  reason: string | null;
}

export interface StandardCurveResult {
  model: StandardCurveModel;
  paramNames: string[];
  params: number[];
  paramSE: (number | null)[];
  n: number;
  dof: number;
  residualSE: number;
  r2: number | null;
  xRange: [number, number];
  tCrit: number;
  confidence: number;
  unknowns: StandardCurveUnknown[];
}

export function fitStandardCurve(req: StandardCurveRequest): Promise<StandardCurveResult> {
  return postJSON("/api/fitting/standard-curve", req);
}
