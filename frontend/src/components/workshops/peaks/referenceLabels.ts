// {hkl}/{phase} peak-label tokens (gap audit 2 #12, OPEN_ITEMS #20): each peak
// takes its hkl and phase from the backend phase matcher (calc/phase_match.py)
// run against the XRD reference sticks on the plot. Every pattern is ranked by
// the matcher's FOM and peaks are handed out best phase first (residual
// matching), so a peak two patterns could claim goes to the better-fitting
// phase; the chance guard is off here, so any peak within `tolerance` of a loaded
// stick is labelled. Fail closed: no wavelength -> refuse with the reason.

import { xrdMatch } from "../../../lib/api/reductions";
import { patternsFromRefLines, peakAssignments } from "../../../lib/xrdMatch";
import type { RefLine } from "../../../lib/types";

export type PeakReference = { hkl: string; phase: string } | null;

/** One entry per centre (null = no stick within tolerance), or `{ problem }`. */
export async function referenceForPeaks(
  centers: readonly number[],
  refLines: readonly RefLine[],
  tolerance: number,
  scanWavelength: number | null,
  range: readonly [number, number],
): Promise<PeakReference[] | { problem: string }> {
  const patterns = patternsFromRefLines(refLines);
  if (patterns.length === 0) return { problem: "{hkl}/{phase} need an XRD reference pattern on the plot — add one from Analyze → XRD reference pattern." };
  const wavelength = scanWavelength ?? patterns.find((p) => p.wavelength)?.wavelength ?? null;
  if (wavelength == null) return { problem: "{hkl}/{phase} need the X-ray wavelength: this file records none and the reference pattern does not state one." };
  const lo = Math.max(0, Math.min(range[0], ...centers) - 1e-6);
  const hi = Math.min(180, Math.max(range[1], ...centers) + 1e-6);
  if (!(hi > lo)) return { problem: "The scan covers no 2θ range to match against." };
  const r = await xrdMatch({
    peaks: [...centers], wavelength, tolerance, two_theta_min: lo, two_theta_max: hi,
    patterns, include_builtin: false, max_phases: 10, min_fom: 0, chance_guard: false,
  });
  return peakAssignments(r, centers.length);
}
