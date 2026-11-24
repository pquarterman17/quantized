// Profiler wrappers (GAP_AUDIT_9 G7): `/api/stats/fit-model/{profile,contour,
// desirability}` (routes/model_evaluate.py). Batch evaluation of a fitted
// model: one request per drag, never one per point. Imported only by the lazy
// Profiler workshop. Response shapes: calc/profile_model.py.

import { postJSON } from "./http";
import type { FittedModel } from "./statsModel";

/** continuous: a number; nominal: a fitted level label, or null = averaged. */
export type ProfilerSetting = number | string | null;
export type ProfilerSettings = Record<string, ProfilerSetting>;

export type GoalKind = "maximize" | "minimize" | "target";
export interface GoalSpec {
  goal: GoalKind;
  lower: number;
  upper: number;
  target: number | null;
}

/** A fitted model plus the fitted range of each continuous factor. */
export type ProfilerModel = FittedModel & { ranges?: Record<string, [number, number]> };

interface TraceBase {
  name: string;
  predicted: number[];
  se: number[];
  lower: number[];
  upper: number[];
  desirability?: number[];
}
export interface ContinuousTrace extends TraceBase { kind: "continuous"; x: number[]; range: [number, number] }
export interface NominalTrace extends TraceBase { kind: "nominal"; levels: string[] }
export type FactorTrace = ContinuousTrace | NominalTrace;

export interface ProfilePoint {
  predicted: number;
  se: number;
  lower: number;
  upper: number;
  desirability?: number;
}

export interface ProfileResponse {
  response: string;
  alpha: number;
  t_crit: number;
  df_error: number;
  rmse: number;
  current: ProfilePoint & { settings: ProfilerSettings };
  factors: FactorTrace[];
}

export interface ContourResponse {
  x_factor: string;
  y_factor: string;
  x: number[];
  y: number[];
  /** z[j][i] is at (x[i], y[j]). */
  z: number[][];
  se: number[][];
  current: ProfilerSettings;
}

export interface DesirabilityResponse {
  settings: ProfilerSettings;
  predicted: number;
  se_mean: number;
  desirability: number;
  n_evaluated: number;
}

export function statsProfile(
  body: { model: ProfilerModel; current: ProfilerSettings; n_points?: number; alpha?: number; goal?: GoalSpec | null },
  signal?: AbortSignal,
): Promise<ProfileResponse> {
  return postJSON("/api/stats/fit-model/profile", body, signal);
}

export function statsContour(
  body: { model: ProfilerModel; current: ProfilerSettings; x_factor: string; y_factor: string; n_x?: number; n_y?: number },
  signal?: AbortSignal,
): Promise<ContourResponse> {
  return postJSON("/api/stats/fit-model/contour", body, signal);
}

export function statsDesirability(
  body: { model: ProfilerModel; goal: GoalSpec },
  signal?: AbortSignal,
): Promise<DesirabilityResponse> {
  return postJSON("/api/stats/fit-model/desirability", body, signal);
}
