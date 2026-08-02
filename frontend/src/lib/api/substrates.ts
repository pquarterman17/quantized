// /api/substrates/* wrappers beyond the three already in lib/api.ts (that
// file is pinned shrink-only, JMP_GAP #14 — same template as api/reference.ts).
// Not re-exported by lib/api.ts (zero headroom there); SubstratesTab imports
// this directly from this path.

import { postJSON } from "./http";

/** Matthews-Blakeslee equilibrium critical thickness h_c (Å, nm) from a
 *  lattice mismatch f. */
export function substratesCriticalThickness(
  mismatch: number,
  b?: number,
  nu?: number,
): Promise<{ h_c: number; h_c_nm: number; mismatch: number; b: number; nu: number }> {
  return postJSON("/api/substrates/critical-thickness", { mismatch, b, nu });
}
