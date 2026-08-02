// X-ray / neutron calculator endpoint wrappers — the `/api/xray/*` half of
// the typed backend client. Extracted from `lib/api.ts` (that file is
// pinned shrink-only, JMP_GAP #14, `architecture.test.ts`): the new
// neutron_calc wrapper (DiraCulator X-ray/neutron tab expansion) would have
// pushed it back over its pin. Same template as `api/stats.ts` and
// `api/plot.ts` — new `/api/xray/*` wrappers go HERE, not in api.ts.
//
// Re-exported by `lib/api.ts`, so every consumer keeps importing from
// `./lib/api` unchanged.

import { postJSON } from "./http";

/** Bragg / Q / energy↔wavelength scalar conversion (calc.xray). `mode` selects
 *  the quantity; `wavelength` is ignored by the energy↔wavelength modes. */
export function xrayCalc(
  mode: string,
  wavelength: number,
  value: number,
  n = 1,
): Promise<{ result: number; unit: string; description: string }> {
  return postJSON("/api/xray/calc", { mode, wavelength, value, n });
}

export interface NeutronResult {
  wavelength_a: number;
  energy_mev: number;
  velocity_m_s: number;
  temperature_k: number;
}

/** Neutron wavelength/energy/velocity/temperature, all derived from one input
 *  `quantity` (`"wavelength"` | `"energy"` | `"velocity"` | `"temperature"`). */
export function neutronCalc(quantity: string, value: number): Promise<NeutronResult> {
  return postJSON("/api/xray/neutron", { quantity, value });
}
