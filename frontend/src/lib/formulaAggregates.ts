// Pure aggregate-statistic helpers for the worksheet formula language's
// mean/sd/min/max/median/sum/count aggregate references (JMP_GAP J11).
// Split out of formula.ts to keep the parser/evaluator module under the
// repo's line ceiling — these are plain array->number reductions with no
// parsing or per-row evaluation concerns of their own.
//
// NaN handling ("omitnan", matching the quantized_matlab convention of
// skipping missing values rather than propagating them through a whole-
// column reduction): every aggregate ignores non-finite (NaN/Infinity)
// entries EXCEPT count(), which counts the finite entries directly (so it
// doubles as "valid N" for the column). An aggregate over zero finite
// values returns NaN — "unknown" is the honest answer — except count(),
// which returns 0 ("how many" is well-defined even when it's none).
//
// sd() is the SAMPLE standard deviation (N-1 / Bessel's correction),
// matching typical descriptive-stats defaults; needs >=2 finite values or
// returns NaN.

export type AggregateName = "mean" | "sd" | "min" | "max" | "median" | "sum" | "count";

/** The reserved aggregate function names (also gates min/max's dual
 *  elementwise-vs-aggregate dispatch in formula.ts). */
export const AGGREGATE_NAMES: ReadonlySet<string> = new Set<string>([
  "mean",
  "sd",
  "min",
  "max",
  "median",
  "sum",
  "count",
]);

function finiteValues(arr: readonly number[]): number[] {
  const out: number[] = [];
  for (const v of arr) if (Number.isFinite(v)) out.push(v);
  return out;
}

/** Reduce a whole column to one of the aggregate statistics above. `name`
 *  must be one of AGGREGATE_NAMES (the caller — formula.ts — enforces this
 *  at parse time). Uses reduce, not `Math.min(...arr)`, so a large worksheet
 *  column can't blow the call-stack argument limit. */
export function computeAggregate(name: AggregateName, arr: readonly number[]): number {
  const finite = finiteValues(arr);
  if (name === "count") return finite.length;
  if (finite.length === 0) return NaN;
  switch (name) {
    case "mean":
      return finite.reduce((s, v) => s + v, 0) / finite.length;
    case "sum":
      return finite.reduce((s, v) => s + v, 0);
    case "min":
      return finite.reduce((m, v) => Math.min(m, v), Infinity);
    case "max":
      return finite.reduce((m, v) => Math.max(m, v), -Infinity);
    case "median": {
      const sorted = [...finite].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    case "sd": {
      if (finite.length < 2) return NaN;
      const mean = finite.reduce((s, v) => s + v, 0) / finite.length;
      const ss = finite.reduce((s, v) => s + (v - mean) ** 2, 0);
      return Math.sqrt(ss / (finite.length - 1));
    }
    default:
      throw new Error(`unknown aggregate "${name as string}"`);
  }
}
