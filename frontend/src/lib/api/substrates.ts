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
  /** The row's material record (calc.material_record): units and a source per field. */
  material?: MaterialRecordWire;
}

/** One cited value: absent fields are null, never defaulted. */
export interface CitedValue {
  value: number;
  /** "" = dimensionless. */
  unit: string;
  source: string;
}

/** Wire form of calc.material_record.MaterialRecord.to_dict(). */
export interface MaterialRecordWire {
  name: string;
  formula: string;
  system: string;
  lattice: { a: number; b: number; c: number; alpha: number; beta: number; gamma: number } | null;
  lattice_unit: { length: string; angle: string } | null;
  lattice_source: string | null;
  centering: string | null;
  centering_source: string | null;
  space_group: string | null;
  space_group_source: string | null;
  cte: CitedValue | null;
  density: CitedValue | null;
  dielectric_constant: CitedValue | null;
  elastic: Record<
    "c11" | "c12" | "c13" | "c33" | "c44" | "c66" | "youngs_modulus" | "poisson_ratio",
    CitedValue | null
  >;
}

/** Built-in substrate reference table. */
export function getSubstrates(): Promise<{ substrates: SubstrateInfo[] }> {
  return getJSON("/api/substrates");
}

/** One substrate by name. */
export function getSubstrate(name: string): Promise<SubstrateInfo> {
  return getJSON(`/api/substrates/${encodeURIComponent(name)}`);
}

/** Miller indices and surface net of a substrate's orientation label. */
export interface SubstrateOrientation {
  name: string;
  orientation: string;
  hkl: number[] | null;
  /** 4-index form, hexagonal cells only. */
  hkil: number[] | null;
  centering: string | null;
  net: { u: number; v: number; gamma: number; area: number } | null;
  net_note: string | null;
}

export function getSubstrateOrientation(name: string): Promise<SubstrateOrientation> {
  return getJSON(`/api/substrates/${encodeURIComponent(name)}/orientation`);
}

/** Epitaxial lattice mismatch f = (a_film − a_sub)/a_sub. */
export function substrateMismatch(
  aFilm: number,
  aSub: number,
): Promise<{ mismatch: number; mismatchPct: number; description: string }> {
  return postJSON("/api/substrates/mismatch", { a_film: aFilm, a_sub: aSub });
}

/** MATLAB-parity Matthews-Blakeslee critical thickness h_c (Å, nm). */
export function substratesCriticalThickness(
  aFilm: number,
  aSub: number,
  nu?: number,
): Promise<{
  h_c: number | null;
  h_c_nm: number | null;
  mismatch: number;
  b: number;
  nu: number;
  matched: boolean;
}> {
  return postJSON("/api/substrates/critical-thickness", { a_film: aFilm, a_sub: aSub, nu });
}
