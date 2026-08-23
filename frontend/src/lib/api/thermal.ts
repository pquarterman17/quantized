// /api/thermal/* wrappers — split out of lib/api.ts (R8 bundle-diet pass,
// 2026-08-23; see api/reference.ts's header for why): useApp.ts's unrelated
// eager imports from lib/api.ts were dragging this lazy-only (ThermalTab
// only) calculator set into the eager bundle purely by file co-location.
// NOT re-exported by lib/api.ts (zero headroom there); ThermalTab imports
// directly from this path.

import { postJSON } from "./http";

/** Wiedemann-Franz κ = L₀·σ·T (W/(m·K)). σ in S/cm, T in K. */
export function thermalWiedemannFranz(
  sigma: number,
  temperature: number,
): Promise<{ kappa: number; sigma: number; temperature: number; lorenz: number }> {
  return postJSON("/api/thermal/wiedemann-franz", { sigma, temperature });
}

/** Debye temperature Θ_D = (ħ/k_B)·v_s·(6π²·n)^(1/3) (K). v_s in m/s, n in m⁻³. */
export function thermalDebye(
  vS: number,
  n: number,
): Promise<{ theta_D: number; v_s: number; n: number }> {
  return postJSON("/api/thermal/debye", { v_s: vS, n });
}

/** Thermal diffusivity α = κ/(ρ·c_p) (m²/s). */
export function thermalDiffusivity(
  kappa: number,
  rho: number,
  cp: number,
): Promise<{ alpha: number; alpha_mm2: number; kappa: number; rho: number; cp: number }> {
  return postJSON("/api/thermal/diffusivity", { kappa, rho, cp });
}
