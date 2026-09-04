// /api/vacuum/* wrappers — split out of lib/api.ts (R8 bundle-diet pass,
// 2026-08-23; see api/reference.ts's header for why): useApp.ts's unrelated
// eager imports from lib/api.ts were dragging this lazy-only (VacuumTab
// only) calculator set into the eager bundle purely by file co-location.
// NOT re-exported by lib/api.ts (zero headroom there); VacuumTab imports
// directly from this path.
//
// Typed-transport pattern (`postApi`, over the generated schema.d.ts):
// request bodies below are checked against the backend's actual pydantic
// models (a wrong/missing/misspelled field is a `tsc` error, not a runtime
// 422). Responses are cast — none of these routes declares a
// `response_model` yet, so the schema only promises `{ [key: string]:
// unknown }` back; the cast documents the shape this module has always
// hand-maintained, same as every other wrapper here before the migration.

import { postApi } from "./http";

/** Mean free path λ = kT/(√2·π·d²·P) (m / mm / µm). P in Pa, T in K, d in m. */
export function vacuumMeanFreePath(
  p: number,
  temperature?: number,
  d?: number,
): Promise<{ mfp: number; mfpMm: number; mfpUm: number; P: number; T: number; d: number }> {
  return postApi("/api/vacuum/mean-free-path", { p, temperature, d }) as Promise<{
    mfp: number;
    mfpMm: number;
    mfpUm: number;
    P: number;
    T: number;
    d: number;
  }>;
}

/** Monolayer formation time from impingement flux. P in Pa. */
export function vacuumMonolayerTime(
  p: number,
  m?: number,
  temperature?: number,
  aSite?: number,
): Promise<{ tMono: number; flux: number; P: number; T: number }> {
  return postApi("/api/vacuum/monolayer-time", { p, m, temperature, a_site: aSite }) as Promise<{
    tMono: number;
    flux: number;
    P: number;
    T: number;
  }>;
}

/** Knudsen number Kn = λ/L and the resulting flow regime. */
export function vacuumKnudsen(
  mfp: number,
  length: number,
): Promise<{ Kn: number; regime: string; mfp: number; L: number }> {
  return postApi("/api/vacuum/knudsen", { mfp, length }) as Promise<{
    Kn: number;
    regime: string;
    mfp: number;
    L: number;
  }>;
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
  return postApi("/api/vacuum/pump-down", { v, s, p0, pf }) as Promise<{
    time: number;
    timeMin: number;
    tau: number;
    V: number;
    S: number;
    P0: number;
    Pf: number;
  }>;
}

/** Sputter yield (atoms/ion) for a material + ion at a given energy (eV). */
export function vacuumSputterYield(
  material: string,
  energy: number,
  ion?: string,
): Promise<{ Y: number; material: string; ion: string; energy: number }> {
  return postApi("/api/vacuum/sputter-yield", { material, energy, ion }) as Promise<{
    Y: number;
    material: string;
    ion: string;
    energy: number;
  }>;
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
  return postApi("/api/vacuum/gas-flow", { p1, p2, d, length, temperature, m }) as Promise<{
    Cmol: number;
    Cvisc: number;
    throughput: number;
    Kn: number;
    regime: string;
  }>;
}
