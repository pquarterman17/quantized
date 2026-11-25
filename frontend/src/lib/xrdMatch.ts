// Phase search/match (OPEN_ITEMS #20): types for POST /api/reductions/xrd-match
// (calc/phase_match.py) and the pure bridges from the plot's reference sticks.
// No React, no store, no fetch. The FOM is this app's (provisional); see the
// backend docstring for its formula.

import type { RefLine } from "./types";

export interface XrdMatchPattern {
  name: string;
  wavelength?: number;
  lines: { two_theta: number; intensity?: number; label?: string }[];
}

export interface XrdMatchPeak {
  peak_index: number;
  two_theta: number;
  ref_two_theta: number;
  delta: number;
  label: string;
  obs_intensity: number | null;
  ref_intensity: number | null;
}

export interface XrdMatchCandidate {
  name: string;
  source: "builtin" | "pattern";
  formula: string;
  absences: string;
  intensity_basis: "reference" | "none";
  wavelength_assumed: boolean;
  fom: number;
  f_obs: number;
  f_ref: number;
  position_term: number;
  intensity_term: number | null;
  n_matched: number;
  n_peaks: number;
  n_strong_lines: number;
  n_strong_observed: number;
  n_reference_lines: number;
  expected_by_chance: number;
  mean_abs_delta: number;
  matches: XrdMatchPeak[];
  step?: number;
}

export interface XrdMatchResult {
  wavelength: number;
  tolerance: number;
  two_theta_min: number;
  two_theta_max: number;
  min_fom: number;
  n_peaks: number;
  n_peaks_outside: number;
  n_candidates: number;
  ranked: XrdMatchCandidate[];
  phases: XrdMatchCandidate[];
  unexplained: { index: number; two_theta: number; d: number | null; intensity: number | null }[];
  skipped: { name: string; reason: string }[];
}

const LAMBDA_NOTE = /λ\s*([0-9]*\.?[0-9]+)/;

/** The loaded stick patterns (one per groupId) as match patterns. Built-in
 *  overlays ("(built-in)") are left out: the backend searches those itself.
 *  A group whose label records λ carries it; "λ unknown" sends none, and the
 *  backend then assumes the scan's λ and flags it. */
export function patternsFromRefLines(refLines: readonly RefLine[]): XrdMatchPattern[] {
  const groups = new Map<string, { name: string; wavelength?: number; lines: XrdMatchPattern["lines"] }>();
  for (const r of refLines) {
    if (r.axis !== "x" || !r.stick || !r.groupId || !Number.isFinite(r.value) || !(r.value > 0 && r.value < 180)) continue;
    let g = groups.get(r.groupId);
    if (!g) {
      const note = r.groupLabel ?? "";
      const lam = LAMBDA_NOTE.exec(note);
      g = { name: note.split(" · λ")[0].trim() || r.groupId, wavelength: lam ? Number(lam[1]) : undefined, lines: [] };
      groups.set(r.groupId, g);
    }
    const intensity = r.stick.intensity;
    g.lines.push({ two_theta: r.value, label: r.label ?? "", ...(Number.isFinite(intensity) && intensity >= 0 ? { intensity } : {}) });
  }
  return [...groups.values()]
    .filter((g) => !g.name.includes("(built-in)") && g.lines.length > 0)
    .map((g) => ({ name: g.name, ...(g.wavelength && g.wavelength >= 0.2 && g.wavelength <= 10 ? { wavelength: g.wavelength } : {}), lines: g.lines }));
}

/** Per input peak: the accepted phase's matched line (hkl label) and phase name. */
export function peakAssignments(result: XrdMatchResult, nPeaks: number): ({ hkl: string; phase: string } | null)[] {
  const out: ({ hkl: string; phase: string } | null)[] = Array.from({ length: nPeaks }, () => null);
  for (const ph of result.phases) for (const m of ph.matches) out[m.peak_index] = { hkl: m.label, phase: ph.name };
  return out;
}
