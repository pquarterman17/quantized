// /api/electrochemistry/* wrappers — split out of lib/api.ts (R8 bundle-diet pass,
// 2026-08-23; see api/reference.ts's header for why): useApp.ts's unrelated
// eager imports from lib/api.ts were dragging this lazy-only (ElectrochemistryTab
// only) calculator set into the eager bundle purely by file co-location.
// NOT re-exported by lib/api.ts (zero headroom there); ElectrochemistryTab imports
// directly from this path.

import { postJSON } from "./http";

/** Nernst potential E = E⁰ − (R·T)/(n·F)·ln(Q) (V). */
export function electrochemNernst(
  e0: number,
  n: number,
  q: number,
  t?: number,
): Promise<{ E: number; E0: number; n: number; Q: number; T: number }> {
  return postJSON("/api/electrochemistry/nernst", { e0, n, q, t });
}

/** Butler-Volmer current density (A/cm²). */
export function electrochemButlerVolmer(
  j0: number,
  eta: number,
  alpha?: number,
  t?: number,
): Promise<{ j: number; jAnodic: number; jCathodic: number; jTafel: number }> {
  return postJSON("/api/electrochemistry/butler-volmer", { j0, eta, alpha, t });
}

/** Tafel slope b = 2.303·R·T/(α·F) (V/decade, mV/decade). */
export function electrochemTafel(
  alpha: number,
  t?: number,
): Promise<{ b: number; bMv: number }> {
  return postJSON("/api/electrochemistry/tafel-slope", { alpha, t });
}

/** Ohmic (iR) drop V = I·R (V, mV). */
export function electrochemOhmicDrop(i: number, r: number): Promise<{ V: number; VmV: number }> {
  return postJSON("/api/electrochemistry/ohmic-drop", { i, r });
}

/** Double-layer capacitance C = ε₀·ε_r·A/d. d in nm, A in cm². */
export function electrochemDoubleLayer(
  epsilon: number,
  d: number,
  area: number,
): Promise<{ C: number; CuF: number; CpF: number; Cspec: number }> {
  return postJSON("/api/electrochemistry/double-layer-capacitance", { epsilon, d, area });
}
