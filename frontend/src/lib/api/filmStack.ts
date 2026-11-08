// /api/epitaxy/stack wrapper (calc.film_stack, plan G4). Imported directly by
// the Film stack calculator tab, not re-exported through the pinned lib/api.ts.

import { postJSON } from "./http";

export interface StackLayerIn {
  name: string;
  a: number;
  c?: number;
  thickness: number;
  nu: number;
  cte: number;
}

export interface RsmPoint {
  qx: number;
  qz: number;
  two_theta: number | null;
  tilt: number | null;
  omega_gi: number | null;
  omega_ge: number | null;
}

export interface StackLayerOut {
  name: string;
  template_a: number;
  mismatch_pct: number;
  h_c_nm: number | null;
  h_c_kind: "finite" | "infinite" | "none";
  thickness_nm: number;
  state: "coherent" | "relaxed";
  in_plane_a: number;
  eps_parallel: number;
  eps_perp: number;
  c_relaxed: number;
  c_strained: number;
  two_theta_00l: (number | null)[];
  eps_thermal: number;
  eps_parallel_total: number;
  rsm: RsmPoint | null;
}

export interface StackResult {
  layers: StackLayerOut[];
  warnings: string[];
  substrate_rsm: RsmPoint | null;
  rsm_reflection: number[] | null;
}

export function evaluateStack(body: {
  substrate: { a: number; cte: number };
  layers: StackLayerIn[];
  growth_temperature: number;
  room_temperature: number;
  wavelength: number;
  max_order: number;
  rsm_reflection?: number[];
}): Promise<StackResult> {
  return postJSON("/api/epitaxy/stack", body);
}
