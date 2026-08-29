// /api/thin-film/* wrappers. `thinFilmSauerbrey` was extracted first (the
// lib/api.ts pin had zero headroom); the original ten joined it in the R8
// bundle-diet pass (2026-08-23, see api/reference.ts's header for why) —
// they were still defined directly in lib/api.ts, so useApp.ts's unrelated
// eager imports from that SAME file were dragging this lazy-only
// (thinfilm/ cards only) calculator set into the eager bundle purely by
// file co-location. NOT re-exported by lib/api.ts (zero headroom there);
// the thinfilm/ cards import everything directly from this path.

import { postJSON } from "./http";

/** Deposition rate = thickness/time. */
export function thinFilmDepositionRate(
  thickness: number,
  time: number,
): Promise<{ rate: number; rate_nm_per_min: number }> {
  return postJSON("/api/thin-film/deposition-rate", { thickness, time });
}

/** Sputter deposition rate from yield, current density, density, molar mass. */
export function thinFilmSputterRate(
  y: number,
  j: number,
  rho: number,
  m: number,
): Promise<{ rate: number; rate_nm_per_min: number }> {
  return postJSON("/api/thin-film/sputter-rate", { y, j, rho, m });
}

/** Thermal diffusion length L = √(D·t). */
export function thinFilmDiffusionLength(
  d: number,
  t: number,
): Promise<{ L: number; L_nm: number; L_um: number }> {
  return postJSON("/api/thin-film/diffusion-length", { d, t });
}

/** Implant dose = I·t/(q·A). */
export function thinFilmDoseFromCurrent(
  current: number,
  time: number,
  area: number,
): Promise<{ dose: number }> {
  return postJSON("/api/thin-film/dose-from-current", { current, time, area });
}

/** Peak concentration from dose + projected-range straggle. */
export function thinFilmDoseToConcentration(
  dose: number,
  rp: number,
  deltaRp: number,
): Promise<{ Cpeak: number }> {
  return postJSON("/api/thin-film/dose-to-concentration", { dose, rp, delta_rp: deltaRp });
}

/** Kiessig fringe thickness from Δq (with refraction correction). */
export function thinFilmKiessig(
  deltaQ: number,
  sld?: number,
  qc?: number,
): Promise<{ thickness: number; thickness_nm: number; Qc: number; thickness_raw: number }> {
  return postJSON("/api/thin-film/kiessig-thickness", { delta_q: deltaQ, sld, qc });
}

/** Series + parallel thermal conductivity of a multilayer stack. */
export function thinFilmMultilayerThermal(
  thicknesses: number[],
  kappas: number[],
): Promise<{ k_series: number; k_parallel: number; total_thickness: number; n_layers: number }> {
  return postJSON("/api/thin-film/multilayer-thermal", { thicknesses, kappas });
}

/** LSS projected range R_p + straggle ΔR_p. */
export function thinFilmProjectedRange(
  ion: string,
  target: string,
  energy: number,
): Promise<{ Rp: number; deltaRp: number; warning: string }> {
  return postJSON("/api/thin-film/projected-range", { ion, target, energy });
}

/** Stoney film stress from substrate curvature. */
export function thinFilmStoneyStress(
  es: number,
  nus: number,
  ts: number,
  tf: number,
  r: number,
): Promise<{ stress: number; stress_MPa: number; stress_GPa: number }> {
  return postJSON("/api/thin-film/stoney-stress", { es, nus, ts, tf, r });
}

/** Thermal-mismatch strain/stress between film and substrate. */
export function thinFilmThermalMismatch(
  alphaFilm: number,
  alphaSub: number,
  deltaT: number,
  e?: number,
  nu?: number,
): Promise<{ strain: number; stress_MPa: number; description: string }> {
  return postJSON("/api/thin-film/thermal-mismatch", {
    alpha_film: alphaFilm,
    alpha_sub: alphaSub,
    delta_t: deltaT,
    e,
    nu,
  });
}

/** QCM areal mass (+ total mass/thickness when area/density given) from a
 *  Sauerbrey frequency shift. `delta_f` is negative for added mass. */
export function thinFilmSauerbrey(
  deltaF: number,
  f0: number,
  area?: number,
  density?: number,
): Promise<{
  areal_mass: number;
  areal_mass_ng_cm2: number;
  Cf: number;
  Cf_hz_cm2_ug: number;
  delta_m?: number;
  delta_m_ng?: number;
  thickness?: number;
  thickness_nm?: number;
}> {
  return postJSON("/api/thin-film/sauerbrey", { delta_f: deltaF, f0, area, density });
}

/** Scherrer crystallite size from FWHM (degrees 2-theta), wavelength (Angstrom),
 *  and peak position (degrees 2-theta), using DiraCulator's fixed K=0.9. */
export function thinFilmScherrer(
  fwhmDeg: number,
  wavelength: number,
  twoThetaDeg: number,
): Promise<{ D: number; D_nm: number; K: number }> {
  return postJSON("/api/thin-film/scherrer", {
    fwhm_deg: fwhmDeg,
    wavelength,
    two_theta_deg: twoThetaDeg,
  });
}
