// /api/vacuum/* wrappers — split out of lib/api.ts (R8 bundle-diet pass,
// 2026-08-23; see api/reference.ts's header for why): useApp.ts's unrelated
// eager imports from lib/api.ts were dragging this lazy-only (VacuumTab
// only) calculator set into the eager bundle purely by file co-location.
// NOT re-exported by lib/api.ts (zero headroom there); VacuumTab imports
// directly from this path.

import { postJSON } from "./http";

/** Mean free path λ = kT/(√2·π·d²·P) (m / mm / µm). P in Pa, T in K, d in m. */
export function vacuumMeanFreePath(
  p: number,
  temperature?: number,
  d?: number,
): Promise<{ mfp: number; mfpMm: number; mfpUm: number; P: number; T: number; d: number }> {
  return postJSON("/api/vacuum/mean-free-path", { p, temperature, d });
}

/** Monolayer formation time from impingement flux. P in Pa. */
export function vacuumMonolayerTime(
  p: number,
  m?: number,
  temperature?: number,
  aSite?: number,
): Promise<{ tMono: number; flux: number; P: number; T: number }> {
  return postJSON("/api/vacuum/monolayer-time", { p, m, temperature, a_site: aSite });
}

/** Knudsen number Kn = λ/L and the resulting flow regime. */
export function vacuumKnudsen(
  mfp: number,
  length: number,
): Promise<{ Kn: number; regime: string; mfp: number; L: number }> {
  return postJSON("/api/vacuum/knudsen", { mfp, length });
}

/** Pump-down time t = (V/S)·ln(P0/Pf). */
export function vacuumPumpDownTime(
  v: number,
  s: number,
  p0: number,
  pf: number,
): Promise<{
  time: number;
  timeMin: number;
  tau: number;
  V: number;
  S: number;
  P0: number;
  Pf: number;
}> {
  return postJSON("/api/vacuum/pump-down", { v, s, p0, pf });
}

/** Sputter yield (atoms/ion) for a material + ion at a given energy (eV). */
export function vacuumSputterYield(
  material: string,
  energy: number,
  ion?: string,
): Promise<{ Y: number; material: string; ion: string; energy: number }> {
  return postJSON("/api/vacuum/sputter-yield", { material, energy, ion });
}

/** Gas-flow conductance (molecular + viscous) and throughput. */
export function vacuumGasFlow(
  p1: number,
  p2: number,
  d: number,
  length: number,
  temperature?: number,
  m?: number,
): Promise<{ Cmol: number; Cvisc: number; throughput: number; Kn: number; regime: string }> {
  return postJSON("/api/vacuum/gas-flow", { p1, p2, d, length, temperature, m });
}
