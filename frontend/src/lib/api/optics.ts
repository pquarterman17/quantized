// /api/optics/* wrappers — split out of lib/api.ts (R8 bundle-diet pass,
// 2026-08-23; see api/reference.ts's header for why): useApp.ts's unrelated
// eager imports from lib/api.ts were dragging this lazy-only (OpticsTab
// only) calculator set into the eager bundle purely by file co-location.
// NOT re-exported by lib/api.ts (zero headroom there); OpticsTab imports
// directly from this path.

import { postJSON } from "./http";

/** Fresnel reflectance/transmittance at an interface (θ in degrees). */
export function opticsFresnel(
  n1: number,
  n2: number,
  theta: number,
): Promise<{ Rs: number; Rp: number; Ts: number; Tp: number }> {
  return postJSON("/api/optics/fresnel", { n1, n2, theta });
}

/** θ_c = arcsin(n₂/n₁) (deg); NaN when n₂ ≥ n₁ (no total internal reflection). */
export function opticsCriticalAngle(n1: number, n2: number): Promise<{ theta_c: number }> {
  return postJSON("/api/optics/critical-angle", { n1, n2 });
}

/** θ_B = arctan(n₂/n₁) (deg). */
export function opticsBrewsterAngle(n1: number, n2: number): Promise<{ theta_b: number }> {
  return postJSON("/api/optics/brewster-angle", { n1, n2 });
}

/** δ = λ/(4πk); depth in the wavelength's unit. */
export function opticsPenetrationDepth(
  n: number,
  k: number,
  wavelength: number,
): Promise<{ depth: number; abs_coeff: number; abs_length: number }> {
  return postJSON("/api/optics/penetration-depth", { n, k, wavelength });
}

/** δ = √(2ρ/(ωμ₀)); ρ in Ω·m (SI), f in Hz. */
export function opticsSkinDepth(
  rho: number,
  f: number,
): Promise<{ delta: number; delta_um: number; delta_nm: number }> {
  return postJSON("/api/optics/skin-depth", { rho, f });
}

/** (n, k) → (ε₁, ε₂): ε₁ = n²−k², ε₂ = 2nk. */
export function opticsRefractiveToDielectric(
  n: number,
  k: number,
): Promise<{ eps1: number; eps2: number }> {
  return postJSON("/api/optics/refractive-to-dielectric", { n, k });
}

/** (ε₁, ε₂) → (n, k) via the physical square root. */
export function opticsDielectricToRefractive(
  eps1: number,
  eps2: number,
): Promise<{ n: number; k: number }> {
  return postJSON("/api/optics/dielectric-to-refractive", { eps1, eps2 });
}
