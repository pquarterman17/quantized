// /api/baseline/* wrappers — split out of lib/api.ts (R8 bundle-diet pass,
// 2026-08-23; see api/reference.ts's header for why): every consumer is the
// lazy baseline workshop, but co-location with eager functions elsewhere in
// lib/api.ts was dragging this set into the eager bundle. NOT re-exported
// by lib/api.ts; the baseline workshop imports directly from this path.

import { postJSON } from "./http";
import type { CalcResult } from "../types";

type BaselineResult = { baseline: (number | null)[] };
type BaselineWithInfo = BaselineResult & { info: CalcResult };

export function baselineEstimate(body: {
  x: number[];
  y: number[];
  method?: string;
}): Promise<BaselineResult> {
  return postJSON("/api/baseline/estimate", body);
}

export function baselineALS(body: {
  y: number[];
  lam?: number;
  p?: number;
}): Promise<BaselineResult> {
  return postJSON("/api/baseline/als", body);
}

export function baselineRollingBall(body: {
  y: number[];
  radius?: number;
  smooth?: number;
}): Promise<BaselineWithInfo> {
  return postJSON("/api/baseline/rollingball", body);
}

export function baselineModPoly(body: {
  y: number[];
  order?: number;
}): Promise<BaselineWithInfo> {
  return postJSON("/api/baseline/modpoly", body);
}

/** Baseline through user-picked (x, y) anchors (GOTO #2); extrapolation is
 *  clamped to the end anchors. `method`: linear | pchip | spline. */
export function baselineAnchor(body: {
  x: number[];
  y: number[];
  anchors: [number, number][];
  method?: string;
}): Promise<BaselineResult> {
  return postJSON("/api/baseline/anchor", body);
}

/** Iterative Shirley step background for XPS/XAS spectra (GOTO #3).
 *  Non-convergence is a 422 with a clear message, never a 500. */
export function baselineShirley(body: {
  x: number[];
  y: number[];
  max_iter?: number;
  tol?: number;
}): Promise<BaselineWithInfo> {
  return postJSON("/api/baseline/shirley", body);
}

/** Hyperbolic (One_on_X) low-angle air-scatter background for powder XRD
 *  (GOTO #7a). Requires strictly positive x (2θ in degrees). */
export function baselineXrdLowAngle(body: {
  x: number[];
  y: number[];
  include_x2?: boolean;
}): Promise<BaselineWithInfo> {
  return postJSON("/api/baseline/xrdlowangle", body);
}

/** Fit a polynomial background from a boxed x/y region (BosonPlotter "Fit BG
 *  from Box"); returns the full-range background + coeffs + region stats. */
export function baselineRegion(body: {
  x: number[];
  y: number[];
  x_min: number;
  x_max: number;
  y_min?: number | null;
  y_max?: number | null;
  order?: number;
}): Promise<{
  background: (number | null)[];
  coeffs: number[];
  n_points: number;
  mean: number;
  std: number;
  min: number;
  max: number;
  order: number;
}> {
  return postJSON("/api/baseline/region", body);
}
