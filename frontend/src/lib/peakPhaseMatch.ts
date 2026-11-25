// {hkl} / {phase} peak-label tokens: the matching itself is the backend's
// phase matcher (calc/phase_match.py via components/workshops/peaks/
// referenceLabels.ts; types and stick bridge in ./xrdMatch). Only the token test
// and the default tolerance live here (pure: no React, no store).
//
// The interim nearest-stick match this file used to hold is replaced
// (OPEN_ITEMS #20). It is still NOT a port of MATLAB `matchPhases.m` (its scoring
// was never available to read); the FOM is this app's, provisional.

/** Degrees 2θ: a peak matches a stick only this close (inclusive). About one
 *  typical lab-diffractometer FWHM (Cu Kα, Bragg-Brentano). */
export const DEFAULT_REFERENCE_TOLERANCE = 0.2;

/** True when a label template reads a reference token. */
export const usesReferenceTokens = (template: string): boolean => /\{(hkl|phase)\}/.test(template);
