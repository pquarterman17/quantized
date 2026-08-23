// /api/diffusion/* wrappers. `diffusionCProfile` was extracted first (the
// lib/api.ts pin had zero headroom); the original three joined it in the R8
// bundle-diet pass (2026-08-23, see api/reference.ts's header for why) —
// they were still defined directly in lib/api.ts, so useApp.ts's unrelated
// eager imports from that SAME file were dragging this lazy-only
// (DiffusionTab only) calculator set into the eager bundle purely by file
// co-location. NOT re-exported by lib/api.ts (zero headroom there);
// DiffusionTab imports everything directly from this path.

import { postJSON } from "./http";

/** D = D₀·exp(−Ea/(k_B·T)) (cm²/s). D₀ in cm²/s, Ea in eV, T in K. */
export function diffusionArrhenius(
  d0: number,
  ea: number,
  t: number,
): Promise<{ D: number; D0: number; Ea: number; T: number }> {
  return postJSON("/api/diffusion/arrhenius", { d0, ea, t });
}

/** Diffusion length L = √(D·t) (cm / µm / nm). */
export function diffusionLength(
  d: number,
  t: number,
): Promise<{ L: number; L_um: number; L_nm: number; D: number; t: number }> {
  return postJSON("/api/diffusion/diffusion-length", { d, t });
}

/** Fick's first law J = −D·ΔC/Δx (atoms/(cm²·s)). */
export function diffusionFickFlux(
  d: number,
  dc: number,
  dx: number,
): Promise<{ J: number; J_abs: number; D: number; dC: number; dx: number }> {
  return postJSON("/api/diffusion/fick-flux", { d, dc, dx });
}

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
