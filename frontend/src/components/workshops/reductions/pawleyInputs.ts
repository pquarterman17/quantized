// Pure input rules for the Pawley panel: field parsing, the physical-domain
// checks the backend's PawleyRequest enforces, axis tying, and the verdict on
// a returned fit. Kept out of usePawley so each rule is testable on its own.

import { xAxisIsTwoThetaDegrees } from "../../../lib/peakTableFit";
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
const within = (v: number, max: number): boolean => positive(v) && v <= max;

/** The route's point cap (routes/reductions.py PAWLEY_MAX_POINTS). */
export const PAWLEY_MAX_POINTS = 50_000;

/** Why these inputs must not be sent, or null when they are physical. The
 *  bounds are the route's own (PawleyRequest), checked here so the user sees
 *  the reason before a request is made. */
export function pawleyInputProblem(n: PawleyNumbers): string | null {
  if (!within(n.a, 1000)) return "a must be a positive length up to 1000 Å";
  if (!within(n.b, 1000)) return "b must be a positive length up to 1000 Å";
  if (!within(n.c, 1000)) return "c must be a positive length up to 1000 Å";
  if (!angle(n.alpha)) return "α must be between 0° and 180°";
  if (!angle(n.beta)) return "β must be between 0° and 180°";
  if (!angle(n.gamma)) return "γ must be between 0° and 180°";
  if (cellVolumeFactor(n.alpha, n.beta, n.gamma) <= 0) {
    return "these cell angles do not describe a real (positive-volume) cell";
  }
  if (!within(n.wavelength, 10)) return "wavelength must be positive and at most 10 Å";
  if (!within(n.fwhm, 20)) return "profile FWHM must be positive and at most 20°";
  return null;
}

/** Other diffractometer angles, which share the "deg" unit with 2θ. */
const OTHER_ANGLE = /\b(omega|phi|chi|psi|tilt|rocking)\b|[ωφχψ]/i;
const TWO_THETA = /2\s*-?\s*(theta|θ)|two[_ -]?theta/i;

/** Why this dataset's x axis is not a usable 2θ scan, or null.
 *
 *  Starts from the fitted-peak table's rule (`xAxisIsTwoThetaDegrees`) and
 *  tightens it for a whole-pattern fit: a label naming a different angle
 *  (a "Phi"/"Omega" axis in degrees passes the unit rule), a 2-D dataset
 *  (whose `time` is a row index even when its metadata says 2θ), and x values
 *  outside a physical 2θ range are all refused. */
export function pawleyAxisProblem(
  axis: { xLabel: string; xUnit: string },
  metadata: Record<string, unknown> | undefined,
  xRange: { min: number; max: number } | null,
): string | null {
  const name = `${axis.xLabel || "unlabeled"} (${axis.xUnit || "no unit recorded"})`;
  if (!xAxisIsTwoThetaDegrees(axis)) return `the x axis is ${name}, not 2θ in degrees`;
  if (!TWO_THETA.test(axis.xLabel) && OTHER_ANGLE.test(axis.xLabel)) {
    return `the x axis is ${name}, a different angle from 2θ`;
  }
  if (metadata?.["is2D"] === true) return "this is a 2-D dataset; extract a 2θ line scan first";
  if (xRange && !(xRange.max > 0 && xRange.max <= 180)) {
    return `x runs ${xRange.min}–${xRange.max}, outside a 2θ range of 0–180°`;
  }
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

/** R_wp / R_wp(background alone) above which the peaks explain too little.
 *  Measured on synthetic Si (backgrounds 10–2000, 2026-09-24): right cells
 *  sit at 0.28–0.42, wrong minima at 0.78–0.89. A heuristic, so it warns
 *  rather than refuses. */
export const PAWLEY_WEAK_FIT_RATIO = 0.6;

/** A warning when the returned fit should not be trusted, or null.
 *
 *  The engine is a local grid search: it only finds the right cell from a
 *  start close to it, and from further out it can settle on a wrong minimum
 *  that still lowers its χ². Absolute R_wp cannot tell that apart from a good
 *  fit (it scales with the background level), so the yardstick is the R_wp of
 *  the linear background alone. The warning is shown beside the result and
 *  saved with it; the result itself is not hidden. */
export function pawleyVerdict(r: PawleyResult, refined: boolean): string | null {
  if (r.rwp == null || r.rwp_background == null) {
    return "R_wp is undefined for this pattern (no positive intensity).";
  }
  if (r.rwp > PAWLEY_WEAK_FIT_RATIO * r.rwp_background) {
    return (
      "The fitted reflections explain little beyond the background: the cell, phase, " +
      "centering, wavelength or profile width is likely wrong. Start closer to the true cell."
    );
  }
  if (refined && r.rwp_initial != null && r.rwp > r.rwp_initial * (1 + 1e-3)) {
    return "The refinement ended worse than its starting cell. Start closer to the true cell.";
  }
  if (refined && !r.converged) {
    return "The search hit its iteration limit before settling; the cell may not be final.";
  }
  return null;
}
