// /api/diffusion/* wrappers beyond the three already in lib/api.ts (that
// file is pinned shrink-only, JMP_GAP #14 — same template as api/reference.ts).
// Not re-exported by lib/api.ts (zero headroom there); DiffusionTab imports
// this directly from this path.

import { postJSON } from "./http";

/** Constant-source diffusion profile c(x,t) = c0*erfc(x / (2*sqrt(D*t))).
 *  `x` may be a single depth or a list; `c` mirrors that shape in the reply. */
export function diffusionCProfile(
  x: number | number[],
  t: number,
  d: number,
  c0: number,
): Promise<{ c: number | number[]; x: number | number[]; t: number; D: number; c0: number; L: number }> {
  return postJSON("/api/diffusion/c-profile", { x, t, d, c0 });
}
