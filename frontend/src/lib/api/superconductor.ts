// /api/superconductor/* wrappers — split out of lib/api.ts (R8 bundle-diet pass,
// 2026-08-23; see api/reference.ts's header for why): useApp.ts's unrelated
// eager imports from lib/api.ts were dragging this lazy-only (SuperconductorTab
// only) calculator set into the eager bundle purely by file co-location.
// NOT re-exported by lib/api.ts (zero headroom there); SuperconductorTab imports
// directly from this path.

import { postJSON } from "./http";

/** λ(T) = λ₀/√(1 − (T/Tc)⁴) (nm). */
export function scLondonDepth(
  lambda0: number,
  t: number,
  tc: number,
): Promise<{ lambda: number; lambda0: number; T: number; Tc: number }> {
  return postJSON("/api/superconductor/london-depth", { lambda0, t, tc });
}

/** ξ(T) = ξ₀/√(1 − (T/Tc)²) (nm). */
export function scCoherenceLength(
  xi0: number,
  t: number,
  tc: number,
): Promise<{ xi: number; xi0: number; T: number; Tc: number }> {
  return postJSON("/api/superconductor/coherence-length", { xi0, t, tc });
}

/** κ = λ/ξ; type 'I' (κ < 1/√2) or 'II'. */
export function scGlParameter(
  lambda: number,
  xi: number,
): Promise<{ kappa: number; lambda: number; xi: number; type: string }> {
  return postJSON("/api/superconductor/gl-parameter", { lambda_: lambda, xi });
}

/** Hc, Hc1, Hc2 (Oe) and type; pass material for preset λ/ξ. */
export function scCriticalFields(
  hc0: number,
  tc: number,
  t: number,
  material?: string,
): Promise<{ Hc: number; Hc1: number; Hc2: number; type: string; T: number; Tc: number }> {
  return postJSON("/api/superconductor/critical-fields", { hc0, tc, t, material });
}

/** Jd = Hc(T)/(3√6·π·λ(T)) (A/cm² and MA/cm²). */
export function scDepairingCurrent(
  hc0: number,
  lambda0: number,
  tc: number,
  t: number,
): Promise<{ Jd: number; JdMA: number; T: number; Tc: number }> {
  return postJSON("/api/superconductor/depairing-current", { hc0, lambda0, tc, t });
}

/** Δ₀ = 1.764·k_B·Tc (meV); Mühlschlegel Δ(T) when T given. */
export function scBcsGap(
  tc: number,
  t?: number,
): Promise<{ delta0: number; ratio: number; deltaT: number; Tc: number; T: number }> {
  return postJSON("/api/superconductor/bcs-gap", { tc, t });
}
