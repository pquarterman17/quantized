// /api/surface-fit, /api/optical-gap and /api/fit-implicit wrappers (gap audit 5
// lane I). Lazy-workshop-only, so they live in their own sibling, not in
// lib/api.ts (see that file's header) and are NOT re-exported from it.

import { getJSON, postJSON } from "./http";

export interface SurfaceModelInfo {
  name: string;
  param_names: string[];
  description: string;
}

export interface SurfaceXyz {
  x: number[];
  y: number[];
  z: number[];
  model: string;
}

/** One row of the parameter-inference table (null = not estimable). */
export interface ParamInference {
  value: number | null;
  error: number | null;
  t: number | null;
  prob: number | null;
  lcl: number | null;
  ucl: number | null;
}

export interface SurfaceFitResult {
  model_name: string;
  param_names: string[];
  params: (number | null)[];
  errors: (number | null)[];
  inference: ParamInference[];
  level: number;
  /** The finite (x, y, z) triples the fit used, with the model surface. */
  x: number[];
  y: number[];
  z: number[];
  z_fit: number[];
  residuals: number[];
  r2: number | null;
  rmse: number | null;
  chi_sq_red: number | null;
  n_points: number;
  n_free: number;
  dof: number;
  exit_flag: number;
}

export const surfaceModels = (): Promise<SurfaceModelInfo[]> => getJSON("/api/surface-fit/models");

export const surfaceGuess = (body: SurfaceXyz): Promise<{ param_names: string[]; p0: number[] }> =>
  postJSON("/api/surface-fit/guess", body);

export const surfaceFit = (
  body: SurfaceXyz & { p0?: number[]; lower?: (number | null)[]; upper?: (number | null)[]; level?: number },
): Promise<SurfaceFitResult> => postJSON("/api/surface-fit/fit", body);

export type TransitionKind = "direct" | "direct-forbidden" | "indirect" | "indirect-forbidden";

export interface TaucBody {
  x: number[];
  y: number[];
  x_unit: "eV" | "nm";
  signal: "alpha" | "transmittance";
  percent?: boolean;
  thickness_nm?: number;
  kind: TransitionKind;
  e_min?: number;
  e_max?: number;
  level?: number;
}

export interface TaucResult {
  kind: TransitionKind;
  label: string;
  gamma: number;
  eg: number;
  eg_se: number | null;
  eg_lcl: number | null;
  eg_ucl: number | null;
  level: number;
  slope: number;
  intercept: number;
  r2: number | null;
  n_fit: number;
  e_min: number;
  e_max: number;
  auto_window: boolean;
  energy: number[];
  tauc: number[];
  alpha: number[];
  fit_energy: number[];
  fit_tauc: number[];
}

export const taucFit = (body: TaucBody): Promise<TaucResult> => postJSON("/api/optical-gap/tauc", body);

export interface EllipseResult {
  n_points: number;
  geometric: boolean;
  converged: boolean;
  center_x: number;
  center_y: number;
  semi_major: number;
  semi_minor: number;
  angle_deg: number;
  center_x_se: number | null;
  center_y_se: number | null;
  semi_major_se: number | null;
  semi_minor_se: number | null;
  angle_deg_se: number | null;
  rms: number;
  algebraic: { center_x: number; center_y: number; semi_major: number; semi_minor: number; angle_deg: number };
  residuals: number[];
  curve_x: number[];
  curve_y: number[];
}

export const ellipseFit = (body: { x: number[]; y: number[]; geometric?: boolean }): Promise<EllipseResult> =>
  postJSON("/api/fit-implicit/ellipse", body);
