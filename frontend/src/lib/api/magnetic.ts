// /api/magnetic/* wrappers beyond the five already in lib/api.ts (that file
// is pinned shrink-only, JMP_GAP #14 — same template as api/reference.ts).
// Not re-exported by lib/api.ts (zero headroom there); MagneticTab imports
// this directly from this path.

import { postJSON } from "./http";

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
