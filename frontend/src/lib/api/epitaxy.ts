// /api/epitaxy/* wrappers (calc.surface_net): the reduced in-plane lattice
// of a plane and the film-on-substrate net mismatch (plan G1). Imported
// directly by OrientedMismatchCard, not re-exported through the pinned lib/api.ts.

import { postJSON } from "./http";

export interface PlaneSpec {
  a: number;
  b?: number;
  c?: number;
  alpha?: number;
  beta?: number;
  gamma?: number;
  centering: string;
  /** (h k l) or (h k i l). */
  hkl: number[];
}

export interface SurfaceNet {
  u: number;
  v: number;
  gamma: number;
  area: number;
  u_frac: number[];
  v_frac: number[];
  hkl: number[];
  centering: string;
}

export interface NetMismatch {
  f_u_pct: number;
  f_v_pct: number;
  f_area_pct: number;
  delta_gamma: number;
  swapped: boolean;
  film: SurfaceNet;
  substrate: SurfaceNet;
}

export function surfaceNet(plane: PlaneSpec): Promise<SurfaceNet> {
  return postJSON("/api/epitaxy/surface-net", plane);
}

export function netMismatch(film: PlaneSpec, substrate: PlaneSpec): Promise<NetMismatch> {
  return postJSON("/api/epitaxy/net-mismatch", { film, substrate });
}

export interface CoincidenceMatch {
  film_index: number;
  substrate_index: number;
  area: number;
  f_u_pct: number;
  f_v_pct: number;
  f_area_pct: number;
  delta_gamma: number;
  rotation: number;
  film_direction: number[];
  substrate_direction: number[];
  film_direction_4: number[] | null;
  substrate_direction_4: number[] | null;
}

export interface CoincidenceResult {
  matches: CoincidenceMatch[];
  n_found: number;
  rotation_period: number;
  film_net: SurfaceNet;
  substrate_net: SurfaceNet;
}

/** Coincidence-lattice (supercell) matches; `max_strain` is a fraction. */
export function coincidenceSearch(
  film: PlaneSpec,
  substrate: PlaneSpec,
  opts: { max_strain: number; max_area: number; max_angle?: number; max_results?: number },
): Promise<CoincidenceResult> {
  return postJSON("/api/epitaxy/coincidence", { film, substrate, ...opts });
}
