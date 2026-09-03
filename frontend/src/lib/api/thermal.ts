// /api/thermal/* wrappers — split out of lib/api.ts (R8 bundle-diet pass,
// 2026-08-23; see api/reference.ts's header for why): useApp.ts's unrelated
// eager imports from lib/api.ts were dragging this lazy-only (ThermalTab
// only) calculator set into the eager bundle purely by file co-location.
// NOT re-exported by lib/api.ts (zero headroom there); ThermalTab imports
// directly from this path.
//
// Typed-transport pattern (`postApi`, over the generated schema.d.ts) — see
// api/vacuum.ts's header for the full rationale. Short version: request
// bodies are checked against the backend's actual pydantic models; response
// casts document a shape the schema itself doesn't promise yet (no
// `response_model` on these routes).

import { postApi } from "./http";

/** Wiedemann-Franz κ = L₀·σ·T (W/(m·K)). σ in S/cm, T in K. */
export function thermalWiedemannFranz(
  sigma: number,
  temperature: number,
): Promise<{ kappa: number; sigma: number; temperature: number; lorenz: number }> {
  return postApi("/api/thermal/wiedemann-franz", { sigma, temperature }) as Promise<{
    kappa: number;
    sigma: number;
    temperature: number;
    lorenz: number;
  }>;
}

/** Debye temperature Θ_D = (ħ/k_B)·v_s·(6π²·n)^(1/3) (K). v_s in m/s, n in m⁻³. */
export function thermalDebye(
  vS: number,
  n: number,
): Promise<{ theta_D: number; v_s: number; n: number }> {
  return postApi("/api/thermal/debye", { v_s: vS, n }) as Promise<{
    theta_D: number;
    v_s: number;
    n: number;
  }>;
}

/** Thermal diffusivity α = κ/(ρ·c_p) (m²/s). */
export function thermalDiffusivity(
  kappa: number,
  rho: number,
  cp: number,
): Promise<{ alpha: number; alpha_mm2: number; kappa: number; rho: number; cp: number }> {
  return postApi("/api/thermal/diffusivity", { kappa, rho, cp }) as Promise<{
    alpha: number;
    alpha_mm2: number;
    kappa: number;
    rho: number;
    cp: number;
  }>;
}
