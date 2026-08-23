// /api/magnetic/* wrappers. `magneticCurieWeissFit` was extracted first (the
// lib/api.ts pin had zero headroom); the original five joined it in the R8
// bundle-diet pass (2026-08-23, see api/reference.ts's header for why) —
// they were still defined directly in lib/api.ts, so useApp.ts's unrelated
// eager imports from that SAME file were dragging this lazy-only
// (MagneticTab only) calculator set into the eager bundle purely by file
// co-location. NOT re-exported by lib/api.ts (zero headroom there);
// MagneticTab imports everything directly from this path.

import { postJSON } from "./http";

/** Moment → emu / A·m² / µ_B (+ magnetization & µ_B/atom when V, atoms given). */
export function magneticMomentConvert(
  value: number,
  unit: string,
  volume?: number,
  atoms?: number,
): Promise<{
  emu: number;
  am2: number;
  mu_b: number;
  m_cgs: number | null;
  m_si: number | null;
  mu_b_per_atom: number | null;
}> {
  return postJSON("/api/magnetic/moment-convert", { value, unit, volume, atoms });
}

/** Demagnetizing factors Nz, Nxy, 4πNz from a geometry label. */
export function magneticDemag(
  shape: string,
): Promise<{ Nz: number; Nxy: number; shape: string; n_cgs: number }> {
  return postJSON("/api/magnetic/demag", { shape });
}

/** µ_eff (µ_B) and order type from Curie constant C and Weiss temperature θ. */
export function magneticCurieWeiss(
  c: number,
  theta: number,
): Promise<{ mu_eff: number; C: number; theta: number; mag_type: string }> {
  return postJSON("/api/magnetic/curie-weiss", { C: c, theta });
}

/** Langevin L(x) = coth(x) − 1/x; x = µH/(k_B T) (CGS: emu, Oe, K). */
export function magneticLangevin(
  mu: number,
  fieldOe: number,
  temperature: number,
): Promise<{ L: number; x: number; n_mu_b: number }> {
  return postJSON("/api/magnetic/langevin", { mu, field_oe: fieldOe, temperature });
}

/** Domain-wall width δ = π√(A/K) and energy E = 4√(AK). */
export function magneticDomainWall(
  exchangeA: number,
  anisotropyK: number,
): Promise<{ delta_cm: number; delta_nm: number; e_wall_erg_cm2: number; e_wall_mj_m2: number }> {
  return postJSON("/api/magnetic/domain-wall", {
    exchange_a: exchangeA,
    anisotropy_k: anisotropyK,
  });
}

/** Curie-Weiss fit of a 1/chi vs T sweep -> theta_CW (K), C (emu*K/mol),
 *  mu_eff (mu_B), fit R^2, and the inv_chi series used for the fit. */
export function magneticCurieWeissFit(body: {
  temperature: number[];
  susceptibility: number[];
  fit_range?: [number, number] | null;
}): Promise<{
  theta_cw: number;
  C: number;
  mu_eff: number;
  fit_line: [number, number];
  r2: number;
  inv_chi: number[];
}> {
  return postJSON("/api/magnetic/curie-weiss-fit", body);
}
