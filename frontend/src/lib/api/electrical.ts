// /api/electrical/* wrappers. `electricalHallSweep`/`electricalVanDerPauw`
// were extracted first (the lib/api.ts pin had zero headroom); the original
// six joined them in the R8 bundle-diet pass (2026-08-23, see
// api/reference.ts's header for why) — they were still defined directly in
// lib/api.ts, so useApp.ts's unrelated eager imports from that SAME file
// were dragging this lazy-only (ElectricalTab only) calculator set into the
// eager bundle purely by file co-location. NOT re-exported by lib/api.ts
// (zero headroom there); ElectricalTab imports everything directly from
// this path.

import { postJSON } from "./http";

/** ρ = R_s·t (Ω·cm). Thickness t in cm. */
export function electricalResistivity(rs: number, t: number): Promise<{ rho: number }> {
  return postJSON("/api/electrical/resistivity", { rs, t });
}

/** R_s = ρ/t (Ω/sq). */
export function electricalSheetResistance(rho: number, t: number): Promise<{ Rs: number }> {
  return postJSON("/api/electrical/sheet-resistance", { rho, t });
}

/** σ = 1/ρ (S/cm). */
export function electricalConductivity(rho: number): Promise<{ sigma: number }> {
  return postJSON("/api/electrical/conductivity", { rho });
}

/** μ = 1/(q·n·ρ) (cm²/V·s). */
export function electricalMobility(rho: number, n: number): Promise<{ mu: number }> {
  return postJSON("/api/electrical/mobility", { rho, n });
}

/** J = I/A (A/cm²). */
export function electricalCurrentDensity(i: number, area: number): Promise<{ J: number }> {
  return postJSON("/api/electrical/current-density", { i, area });
}

/** Single-point Hall: R_H (cm³/C), carrier density (cm⁻³), carrier type. */
export function electricalHall(
  vH: number,
  i: number,
  b: number,
  t: number,
): Promise<{ r_h: number; carrier_density: number; carrier_type: string }> {
  return postJSON("/api/electrical/hall", { v_h: vH, i, b, t });
}

/** Single-carrier Hall analysis from an R_xy vs H sweep: linear fit -> R_H,
 *  carrier density, carrier type, mobility (when sigma given), fit R^2. */
export function electricalHallSweep(body: {
  field: number[];
  hall_resistance: number[];
  thickness?: number;
  field_unit?: string;
  sigma?: number;
}): Promise<{
  r_h: number;
  carrier_density: number;
  carrier_type: string;
  mobility: number;
  fit_r2: number;
}> {
  return postJSON("/api/electrical/hall-sweep", body);
}

/** Sheet resistance R_s from a van der Pauw Ra/Rb measurement (+ resistivity
 *  when thickness is given). */
export function electricalVanDerPauw(
  ra: number,
  rb: number,
  thickness?: number,
): Promise<{ Rs: number; Ra: number; Rb: number; rho?: number }> {
  return postJSON("/api/electrical/van-der-pauw", { r_a: ra, r_b: rb, thickness });
}
