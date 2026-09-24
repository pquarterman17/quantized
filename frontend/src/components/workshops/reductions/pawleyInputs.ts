// Pure input rules for the Pawley panel: field parsing, the physical-domain
// checks the backend's PawleyRequest enforces, axis tying, and the verdict on
// a returned fit. Kept out of usePawley so each rule is testable on its own.

import type { PawleyResult } from "../../../lib/reductionTypes";

export type PawleyField = "a" | "b" | "c" | "alpha" | "beta" | "gamma" | "wavelength" | "fwhm";
export type PawleyFields = Record<PawleyField, string>;

/** Which lattice axes the refinement moves together (calc/pawley.py `tie`). */
export type PawleyTie = "abc" | "ab" | "none";

export const PAWLEY_DEFAULT_WAVELENGTH = 1.5406;

export const PAWLEY_DEFAULT_FIELDS: PawleyFields = {
  a: "5.43",
  b: "5.43",
  c: "5.43",
  alpha: "90",
  beta: "90",
  gamma: "90",
  wavelength: String(PAWLEY_DEFAULT_WAVELENGTH),
  fwhm: "0.12",
};

/** A text field as a number; empty or unparseable is NaN, never 0. */
export function parseField(s: string): number {
  return s.trim() === "" ? Number.NaN : Number(s);
}

/** ``1 − cos²α − cos²β − cos²γ + 2·cosα·cosβ·cosγ``: positive iff the angles
 *  describe a real cell. The same test as the route's model validator. */
export function cellVolumeFactor(alphaDeg: number, betaDeg: number, gammaDeg: number): number {
  const [ca, cb, cg] = [alphaDeg, betaDeg, gammaDeg].map((d) => Math.cos((d * Math.PI) / 180));
  return 1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg;
}

export interface PawleyNumbers {
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
  wavelength: number;
  fwhm: number;
}

/** Parsed fields, with tied axes taken from `a` so the request matches what
 *  the panel shows. */
export function pawleyNumbers(fields: PawleyFields, tie: PawleyTie): PawleyNumbers {
  const a = parseField(fields.a);
  return {
    a,
    b: tie === "none" ? parseField(fields.b) : a,
    c: tie === "abc" ? a : parseField(fields.c),
    alpha: parseField(fields.alpha),
    beta: parseField(fields.beta),
    gamma: parseField(fields.gamma),
    wavelength: parseField(fields.wavelength),
    fwhm: parseField(fields.fwhm),
  };
}

const positive = (v: number): boolean => Number.isFinite(v) && v > 0;
const angle = (v: number): boolean => Number.isFinite(v) && v > 0 && v < 180;

/** Why these inputs must not be sent, or null when they are physical. */
export function pawleyInputProblem(n: PawleyNumbers): string | null {
  if (!positive(n.a)) return "a must be a positive number";
  if (!positive(n.b)) return "b must be a positive number";
  if (!positive(n.c)) return "c must be a positive number";
  if (!angle(n.alpha)) return "α must be between 0° and 180°";
  if (!angle(n.beta)) return "β must be between 0° and 180°";
  if (!angle(n.gamma)) return "γ must be between 0° and 180°";
  if (cellVolumeFactor(n.alpha, n.beta, n.gamma) <= 0) {
    return "these cell angles do not describe a real (positive-volume) cell";
  }
  if (!positive(n.wavelength)) return "wavelength must be a positive number";
  if (!positive(n.fwhm)) return "profile FWHM must be a positive number";
  return null;
}

/** Min and max of a finite array without spreading it into Math.min/max,
 *  which throws a RangeError on arrays of a few hundred thousand points. */
export function scanRange(x: readonly number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const v of x) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/** A warning when the returned fit should not be trusted, or null.
 *
 *  The engine is a local grid search: it only finds the right cell from a
 *  start close to it, and it can wander to a wrong minimum that still lowers
 *  its unweighted χ² while R_wp rises. A result that ended no better than its
 *  own starting cell, or with R_wp ≥ 100 % (worse than no model), is exactly
 *  that case, and must not be presented as a refined cell. */
export function pawleyVerdict(r: PawleyResult, refined: boolean): string | null {
  if (r.rwp == null) return "R_wp is undefined for this pattern (no positive intensity).";
  if (r.rwp >= 1) {
    return "R_wp ≥ 100 %: the model fits worse than none. Check the phase, centering and wavelength.";
  }
  if (refined && r.rwp_initial != null && r.rwp > r.rwp_initial) {
    return "The refinement ended worse than its starting cell. Start closer to the true cell.";
  }
  if (refined && !r.converged) {
    return "The search hit its iteration limit before settling; the cell may not be final.";
  }
  return null;
}
