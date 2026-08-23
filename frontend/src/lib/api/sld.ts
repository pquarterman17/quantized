// /api/sld/* wrapper — split out of lib/api.ts (R8 bundle-diet pass,
// 2026-08-23; see api/reference.ts's header for why): useApp.ts's unrelated
// eager imports from lib/api.ts were dragging this lazy-only (SldTab/
// useSldCalc only) formula-SLD calculator into the eager bundle purely by
// file co-location. NOT re-exported by lib/api.ts (zero headroom there);
// consumers import directly from this path.

import { postJSON } from "./http";

/** One probe's SLD block: real + imaginary (absorption) SLD in 10⁻⁶ Å⁻². */
export interface SldProbe {
  wavelength: number;
  sld_real: number;
  sld_imag: number;
  penetration: number; // 1/e depth, cm
  qc: number; // critical wavevector, 1/Å
  // neutron-only extras:
  incoherent?: number;
  xs_coherent?: number;
  xs_absorption?: number;
  xs_incoherent?: number;
}

export interface SldFormulaResult {
  formula: string;
  molar_mass: number;
  number_density: number;
  neutron: SldProbe;
  xray: SldProbe;
}

/** Neutron + X-ray SLD (real + imaginary/absorption) from a chemical formula,
 *  mass density, and probe wavelengths. Wraps NIST-NCNR-grade periodictable. */
export function sldFromFormula(body: {
  formula: string;
  density: number;
  neutron_wavelength?: number;
  xray_wavelength?: number;
}): Promise<SldFormulaResult> {
  return postJSON("/api/sld/formula", body);
}
