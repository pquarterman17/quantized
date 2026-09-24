// /api/reflectivity/* wrappers — split out of lib/api.ts (R8 bundle-diet
// pass, 2026-08-23; see api/reference.ts's header for why): its one
// consumer is the lazy reflectivity workshop. NOT re-exported by
// lib/api.ts; useReflectivity.ts imports directly from this path.

import { getJSON, postJSON } from "./http";
import type { SldPreset } from "../types";
import type { components } from "./schema";

/** Material SLD presets for building reflectivity models. */
export function reflPresets(): Promise<{ presets: SldPreset[] }> {
  return getJSON("/api/reflectivity/presets");
}

/** A layer row: [thickness Å, SLD_real Å⁻², SLD_imag Å⁻², roughness Å]. */
export type ReflLayer = [number, number, number, number];

/** Simulate specular reflectivity R(Q) from a layer stack (Parratt recursion). */
export function reflSimulate(body: {
  layers: ReflLayer[];
  q_min?: number;
  q_max?: number;
  n_points?: number;
  roughness?: boolean;
  scale?: number;
  background?: number;
  resolution?: number | null;
}): Promise<{ q: number[]; r: (number | null)[] }> {
  return postJSON("/api/reflectivity/simulate", body);
}

/** Compute the SLD(z) depth profile for a layer stack (error-function interfaces). */
export function reflSldProfile(body: {
  layers: ReflLayer[];
  n_points?: number;
  padding?: number;
}): Promise<{ z: number[]; sld: (number | null)[] }> {
  return postJSON("/api/reflectivity/sld-profile", body);
}

// ── fit a layer model to measured data (P2.2) ───────────────────────────────

/** Request body for POST /api/reflectivity/fit (generated from the route's
 *  pydantic models in routes/reflectivity.py). */
export type ReflFitRequest = components["schemas"]["ReflFitRequest"];
export type ReflFitChannel = components["schemas"]["ReflFitChannel"];
export type ReflFitParameter = components["schemas"]["ReflFitParameter"];

/** One fitted parameter. `stderr` is null when the parameter was fixed, ended
 *  on a bound, or is not determined by the data (calc/refl_fit.py). */
export interface ReflFitParamResult {
  name: string;
  value: number;
  stderr: number | null;
  vary: boolean;
  tie: string | null;
  at_bound: boolean;
}

/** One channel's fitted points — only the points the fit used, in row order. */
export interface ReflFitCurve {
  label: string;
  spin: "+" | "-" | null;
  q: number[];
  r: number[];
  dr: number[] | null;
  model: (number | null)[];
  residual: (number | null)[];
}

/** The fit response. The route's OpenAPI response is an untyped dict, so this
 *  mirrors `fit_reflectivity`'s return value by hand. `dr` weighting reports
 *  `chi2`/`reduced_chi2`; `log` weighting reports `sum_sq_log`/
 *  `reduced_sum_sq_log` and leaves the chi-square fields null. */
export interface ReflFitResult {
  parameters: ReflFitParamResult[];
  free: string[];
  correlation: (number | null)[][];
  chi2: number | null;
  reduced_chi2: number | null;
  sum_sq_log: number | null;
  reduced_sum_sq_log: number | null;
  n_points: number;
  n_free: number;
  success: boolean;
  message: string;
  n_evaluations: number;
  weighting: "dr" | "log";
  curves: ReflFitCurve[];
  sld_profiles: { spin: "+" | "-" | null; z: number[]; sld: (number | null)[] }[];
  warnings: string[];
}

/** Fit the layer model to one or more measured curves. `signal` aborts the
 *  request; the server still finishes its own time-bounded run. */
export function reflFit(body: ReflFitRequest, signal?: AbortSignal): Promise<ReflFitResult> {
  return postJSON("/api/reflectivity/fit", body, signal);
}
