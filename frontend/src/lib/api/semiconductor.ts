// /api/semiconductor/* wrappers — split out of lib/api.ts (R8 bundle-diet pass,
// 2026-08-23; see api/reference.ts's header for why): useApp.ts's unrelated
// eager imports from lib/api.ts were dragging this lazy-only (SemiconductorTab
// only) calculator set into the eager bundle purely by file co-location.
// NOT re-exported by lib/api.ts (zero headroom there); SemiconductorTab imports
// directly from this path.

import { postJSON } from "./http";

/** n_i = √(N_c N_v)·exp(−E_g/2k_BT) (cm⁻³). */
export function semiconductorIntrinsic(
  eg: number,
  meStar: number,
  mhStar: number,
  t: number,
): Promise<{ ni: number; Nc: number; Nv: number; Eg: number; T: number }> {
  return postJSON("/api/semiconductor/intrinsic", { eg, me_star: meStar, mh_star: mhStar, t });
}

/** n, p from charge-neutrality + mass-action; doping type. */
export function semiconductorCarrierConc(
  nd: number,
  na: number,
  ni: number,
): Promise<{ n: number; p: number; type: string }> {
  return postJSON("/api/semiconductor/carrier-concentration", { nd, na, ni });
}

/** V_bi = (k_BT/q)·ln(N_a N_d / n_i²) (V). */
export function semiconductorBuiltInPotential(
  na: number,
  nd: number,
  ni: number,
  t: number,
): Promise<{ Vbi: number }> {
  return postJSON("/api/semiconductor/built-in-potential", { na, nd, ni, t });
}

/** Depletion width W, x_n, x_p (nm) and Wcm (cm). */
export function semiconductorDepletionWidth(
  vbi: number,
  na: number,
  nd: number,
  epsilonR: number,
  t: number,
): Promise<{ W: number; Wcm: number; xn: number; xp: number }> {
  return postJSON("/api/semiconductor/depletion-width", { vbi, na, nd, epsilon_r: epsilonR, t });
}

/** D = μ·k_BT/q (cm²/s). */
export function semiconductorDiffusionCoeff(
  mu: number,
  t: number,
): Promise<{ D: number; mu: number; T: number }> {
  return postJSON("/api/semiconductor/diffusion-coeff", { mu, t });
}

/** L = √(D·τ) (cm / µm). */
export function semiconductorDiffusionLength(
  d: number,
  tau: number,
): Promise<{ L: number; Lum: number; D: number; tau: number }> {
  return postJSON("/api/semiconductor/diffusion-length", { d, tau });
}

/** E_F − E_i = k_BT·asinh(Δ/2n_i) (eV). */
export function semiconductorFermiLevel(
  eg: number,
  meStar: number,
  mhStar: number,
  nd: number,
  na: number,
  t: number,
): Promise<{ EF: number; type: string }> {
  return postJSON("/api/semiconductor/fermi-level", {
    eg,
    me_star: meStar,
    mh_star: mhStar,
    nd,
    na,
    t,
  });
}

/** L_D = √(ε₀εᵣk_BT/(q²n)) (nm). */
export function semiconductorDebyeLength(
  n: number,
  epsilonR: number,
  t: number,
): Promise<{ LD: number; LDcm: number }> {
  return postJSON("/api/semiconductor/debye-length", { n, epsilon_r: epsilonR, t });
}

/** n_s = n·t (cm⁻²). */
export function semiconductorSheetCarrierDensity(
  n: number,
  t: number,
): Promise<{ ns: number; n: number; t: number }> {
  return postJSON("/api/semiconductor/sheet-carrier-density", { n, t });
}

/** v_th = √(3k_BT/(m* m₀)) (cm/s). */
export function semiconductorThermalVelocity(
  mStar: number,
  t: number,
): Promise<{ vth: number; mStar: number; T: number }> {
  return postJSON("/api/semiconductor/thermal-velocity", { m_star: mStar, t });
}

/** R_H = (1/q)(pμ_h² − nμ_e²)/(pμ_h + nμ_e)² (cm³/C). */
export function semiconductorHallCoefficient(
  n: number,
  p: number,
  muE: number,
  muH: number,
): Promise<{ RH: number; apparent_type: string }> {
  return postJSON("/api/semiconductor/hall-coefficient", { n, p, mu_e: muE, mu_h: muH });
}

/** Caughey-Thomas μ_e, μ_h (cm²/V·s). */
export function semiconductorMobilityModel(
  material: string,
  t: number,
  n: number,
): Promise<{ muE: number; muH: number; material: string }> {
  return postJSON("/api/semiconductor/mobility-model", { material, t, n });
}
