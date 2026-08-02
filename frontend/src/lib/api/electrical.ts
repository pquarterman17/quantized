// /api/electrical/* wrappers beyond the six already in lib/api.ts (that file
// is pinned shrink-only, JMP_GAP #14 — same template as api/reference.ts).
// Not re-exported by lib/api.ts (zero headroom there); ElectricalTab imports
// these directly from this path.

import { postJSON } from "./http";

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
