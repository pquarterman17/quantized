// /api/substrates/* wrappers + the SubstrateInfo wire type (moved here from
// lib/api.ts / SubstratesTab.tsx — DIRACULATOR_AUDIT P3: the transport layer
// must never import from components/, and lib/api.ts is pinned shrink-only,
// JMP_GAP #14 — same template as api/reference.ts). Not re-exported by
// lib/api.ts; SubstratesTab imports this directly from this path.

import { getJSON, postJSON } from "./http";

/** One substrate row from the reference table (mirrors calc.substrates dict). */
export interface SubstrateInfo {
  name: string;
  formula: string;
  orientation: string;
  a: number | null;
  b: number | null;
  c: number | null;
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  thermalExpansion: number;
  dielectric: number;
  density: number;
  latticeType: string;
}

/** Built-in substrate reference table. */
export function getSubstrates(): Promise<{ substrates: SubstrateInfo[] }> {
  return getJSON("/api/substrates");
}

/** One substrate by name. */
export function getSubstrate(name: string): Promise<SubstrateInfo> {
  return getJSON(`/api/substrates/${encodeURIComponent(name)}`);
}

/** Epitaxial lattice mismatch f = (a_film − a_sub)/a_sub. */
export function substrateMismatch(
  aFilm: number,
  aSub: number,
): Promise<{ mismatch: number; mismatchPct: number; description: string }> {
  return postJSON("/api/substrates/mismatch", { a_film: aFilm, a_sub: aSub });
}

/** Matthews-Blakeslee equilibrium critical thickness h_c (Å, nm) from a
 *  lattice mismatch f. */
export function substratesCriticalThickness(
  mismatch: number,
  b?: number,
  nu?: number,
): Promise<{ h_c: number; h_c_nm: number; mismatch: number; b: number; nu: number }> {
  return postJSON("/api/substrates/critical-thickness", { mismatch, b, nu });
}
