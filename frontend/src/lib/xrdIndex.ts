// XRD indexing against a built-in phase (UX9-F). Pure: types for
// /api/reductions/xrd-phases + /api/reductions/xrd-index (calc/xrd_index.py),
// Bragg d, and the peak-list parser. No React, no store, no fetch.
//
// The phases are the backend's verbatim MATLAB phaseDatabase port
// (calc/phase_database.json); the matcher is calc/xrd_index.match_peaks'
// nearest-reflection rule — NOT a port of MATLAB matchPhases.m (PORT_CHECKLIST
// "Phase matching" stays open).

/** Cu Kα1 (Å): the same default every XRD panel and route uses. */
export const CU_KA1_A = 1.5406;

/** Degrees 2θ — calc/xrd_index.DEFAULT_TOLERANCE_DEG and peakPhaseMatch's default. */
export const DEFAULT_INDEX_TOLERANCE = 0.2;

/** How a phase's systematic absences were decided (calc/xrd_index._absence_kind). */
export type XrdAbsences = "structure factor" | "space group" | "lattice";

export interface XrdPhaseChoice {
  name: string;
  formula: string;
  category: string;
  system: string;
  a: number;
  c: number;
  absences: XrdAbsences;
}

export interface XrdReflection {
  hkl: number[];
  label: string;
  d: number;
  two_theta: number;
  multiplicity: number;
}

export interface XrdPeakMatch {
  peak_two_theta: number | null;
  d_obs: number | null;
  hkl: number[] | null;
  label: string | null;
  d_ref: number | null;
  two_theta_ref: number | null;
  delta: number | null;
}

export interface XrdIndexResult {
  phase: { name: string; formula: string; system: string; centering: string; a: number; c: number };
  absences: XrdAbsences;
  wavelength: number;
  reflections: XrdReflection[];
  tolerance: number;
  matches: XrdPeakMatch[];
  n_matched: number;
}

/** Bragg d (Å) of a first-order reflection at 2θ (degrees); null outside (0, 180). */
export function braggD(twoThetaDeg: number, wavelengthA: number): number | null {
  if (!Number.isFinite(twoThetaDeg) || !(twoThetaDeg > 0 && twoThetaDeg < 180)) return null;
  if (!Number.isFinite(wavelengthA) || !(wavelengthA > 0)) return null;
  return wavelengthA / (2 * Math.sin((twoThetaDeg * Math.PI) / 360));
}

/** Peak positions typed as "28.44, 47.30 56.12" (comma/space/semicolon
 *  separated). Returns the numbers, or a message naming the first bad token. */
export function parsePeakList(text: string): { peaks: number[] } | { problem: string } {
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  const peaks: number[] = [];
  for (const t of tokens) {
    const v = Number(t);
    if (!Number.isFinite(v) || v <= 0 || v >= 180) return { problem: `"${t}" is not a 2θ position between 0 and 180°.` };
    peaks.push(v);
  }
  return { peaks };
}

/** What the absence kind means for the user, or null when it is complete. */
export function absencesNote(kind: XrdAbsences): string | null {
  return kind === "lattice"
    ? "No atomic basis is tabulated for this phase: only lattice-centering absences are applied, so some listed reflections may be absent (glide/screw)."
    : null;
}
