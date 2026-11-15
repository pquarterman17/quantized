// Peak → XRD reference matching for the `{hkl}` / `{phase}` peak-label tokens
// (origin gap audit 2 #12, UX-R6 remainder). Pure: no React, no store.
//
// The reference sticks are the ones the XRD reference-pattern workshop
// (components/workshops/reductions/ReferencePatternSection) puts on the plot
// as `RefLine`s: axis "x", a `stick`, the reflection's (hkl) as `label`, one
// `groupId` per pattern and the pattern's provenance as `groupLabel` on the
// group's first line ("<name> · λ …"). The phase is that name.
//
// Rule: a peak takes the NEAREST stick whose position is within `tolerance`
// (degrees 2θ, inclusive) of the peak's center; ties go to the earlier stick.
// No stick within tolerance → no match: the tokens render blank for that peak
// rather than borrowing a far-away reflection. The default tolerance,
// 0.2° 2θ, is about one typical lab-diffractometer FWHM (Cu Kα, Bragg-
// Brentano), so a match is a peak sitting on the stick, not merely near it.
//
// PARITY GAP: MATLAB's `+calc/+crystal/matchPhases.m` (peak → phase against
// the built-in phase database) is NOT ported — `quantized_matlab` was not in
// the checkout this was written in, so its scoring and tolerance could not be
// read. This is nearest-reference matching against the patterns the user
// loaded, with the documented tolerance above; PORT_CHECKLIST keeps
// `matchPhases` open.

import type { RefLine } from "./types";

/** Degrees 2θ: a peak matches a stick only this close (inclusive). */
export const DEFAULT_REFERENCE_TOLERANCE = 0.2;

export interface MatchedReflection {
  twoTheta: number;
  /** The reflection's label as the pattern gave it (usually its (hkl)). */
  hkl: string;
  /** The reference pattern's name (its group label without the λ note). */
  phase: string;
}

/** Every reference stick on the plot, with its pattern (phase) name. */
export function referenceReflections(refLines: readonly RefLine[]): MatchedReflection[] {
  const phaseOf = new Map<string, string>();
  for (const r of refLines) {
    if (r.groupId && r.groupLabel && !phaseOf.has(r.groupId)) {
      phaseOf.set(r.groupId, r.groupLabel.split(" · λ")[0].trim());
    }
  }
  return refLines
    .filter((r) => r.axis === "x" && r.stick && Number.isFinite(r.value))
    .map((r) => ({ twoTheta: r.value, hkl: r.label ?? "", phase: (r.groupId && phaseOf.get(r.groupId)) || "" }));
}

/** The nearest reflection within `tolerance` of `center`, or null. */
export function matchReflection(
  center: number,
  reflections: readonly MatchedReflection[],
  tolerance: number = DEFAULT_REFERENCE_TOLERANCE,
): MatchedReflection | null {
  if (!Number.isFinite(center) || !(tolerance >= 0)) return null;
  let best: MatchedReflection | null = null;
  let bestD = Infinity;
  for (const r of reflections) {
    const d = Math.abs(r.twoTheta - center);
    if (d <= tolerance && d < bestD) {
      best = r;
      bestD = d;
    }
  }
  return best;
}

/** True when a label template reads a reference token. */
export const usesReferenceTokens = (template: string): boolean => /\{(hkl|phase)\}/.test(template);
