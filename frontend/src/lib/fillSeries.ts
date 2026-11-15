// Origin's Fill Column With (gap audit 4, G12): row numbers, a linear
// sequence, uniform or normal random numbers — the values for one column of
// `rows` cells, pure. store/worksheetFill.ts writes them (one undo step).
//
// The random fills are the same draws as the formula functions rnd(seed) and
// normal(seed) (numpy.random.RandomState(seed).random_sample /
// standard_normal — lib/formulaMath.ts), so a filled column and a computed
// one with the same seed agree, and both match numpy.

import { randomSeries, seedProblem } from "./formulaMath";

export type FillSpec =
  | { kind: "rownum" }
  | { kind: "linear"; start: number; step: number }
  | { kind: "uniform"; seed: number; low: number; high: number }
  | { kind: "normal"; seed: number; mean: number; sd: number };

/** Why `spec` cannot fill a column, or null. */
export function fillProblem(spec: FillSpec): string | null {
  const finite = (v: number, what: string) => (Number.isFinite(v) ? null : `${what} must be a number`);
  switch (spec.kind) {
    case "rownum":
      return null;
    case "linear":
      return finite(spec.start, "the start") ?? finite(spec.step, "the step");
    case "uniform":
      return seedProblem(spec.seed) ?? finite(spec.low, "the low end") ?? finite(spec.high, "the high end") ?? (spec.high < spec.low ? "the high end must not be below the low end" : null);
    case "normal":
      return seedProblem(spec.seed) ?? finite(spec.mean, "the mean") ?? finite(spec.sd, "the SD") ?? (spec.sd < 0 ? "the SD must not be negative" : null);
  }
}

/** The `rows` values of a fill. Throws when `fillProblem` would object. */
export function fillValues(spec: FillSpec, rows: number): number[] {
  const why = fillProblem(spec);
  if (why) throw new Error(why);
  switch (spec.kind) {
    case "rownum":
      return Array.from({ length: rows }, (_, i) => i + 1);
    case "linear":
      // start + i·step (numpy's arange form), not repeated addition: no drift.
      return Array.from({ length: rows }, (_, i) => spec.start + i * spec.step);
    case "uniform":
      return randomSeries("uniform", spec.seed, rows).map((u) => spec.low + (spec.high - spec.low) * u);
    case "normal":
      return randomSeries("normal", spec.seed, rows).map((g) => spec.mean + spec.sd * g);
  }
}

/** The status-line words for a fill. */
export function describeFill(spec: FillSpec): string {
  switch (spec.kind) {
    case "rownum":
      return "row numbers";
    case "linear":
      return `a linear sequence from ${spec.start} in steps of ${spec.step}`;
    case "uniform":
      return `uniform random numbers in [${spec.low}, ${spec.high}) (seed ${spec.seed})`;
    case "normal":
      return `normal random numbers, mean ${spec.mean}, SD ${spec.sd} (seed ${spec.seed})`;
  }
}
