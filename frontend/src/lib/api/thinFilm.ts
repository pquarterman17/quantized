// /api/thin-film/* wrappers beyond the ten already in lib/api.ts (that file
// is pinned shrink-only, JMP_GAP #14 — same template as api/reference.ts).
// Not re-exported by lib/api.ts (zero headroom there); the thinfilm/ cards
// import this directly from this path.

import { postJSON } from "./http";

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
