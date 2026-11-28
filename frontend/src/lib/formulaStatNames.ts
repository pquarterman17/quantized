// Names of the moving-window, column-statistic and conditional-aggregate
// functions (lib/formulaStatCalls.ts), kept in a tiny leaf so the derived-unit
// parser (lib/derivedExprAst.ts, lib/derivedUnits.ts) can accept exactly the
// same names the lazy evaluator does without importing the evaluator.

export const WINDOW_NAMES: readonly string[] = ["movavg", "movmedian", "movrms", "movsum", "movsd", "movslope"];
export const PAIR_NAMES: readonly string[] = ["correl", "cov", "slope", "intercept"];
export const COLUMN_NAMES: readonly string[] = ["skew", "kurt", "geomean", "harmean", "mad", "mode"];
export const COND_NAMES: readonly string[] = ["sumif", "countif", "averageif", "maxifs", "minifs"];

/** The whole-column signal functions (lib/formulaSignal.ts); the exported script computes them too. */
export const SIGNAL_NAMES: ReadonlySet<string> = new Set(["movmax", "movmin", "cummax", "cummin", "cumprod", "savgol"]);

/** Every function of this family. */
export const STAT_CALL_NAMES: ReadonlySet<string> = new Set([...WINDOW_NAMES, "emovavg", ...PAIR_NAMES, "percentile", ...COLUMN_NAMES, ...COND_NAMES]);

/** A function of the stat family or the whole-column signal family: both parse like the text functions in the derived-unit parser. */
export const isStatOrSignal = (fn: string): boolean => STAT_CALL_NAMES.has(fn) || SIGNAL_NAMES.has(fn);

/** Result keeps the unit of the first column argument. */
const SAME_UNIT_AS_FIRST = new Set(["movavg", "movmedian", "movrms", "movsum", "movsd", "emovavg", "percentile", "geomean", "harmean", "mad", "mode", "sumif", "averageif", "maxifs", "minifs", "movmax", "movmin", "cummax", "cummin", "savgol"]);
/** Result is a pure number (a count, a correlation, a shape ratio). */
const UNITLESS = new Set(["correl", "skew", "kurt", "countif"]);

/** "same": the first argument's unit; "none": dimensionless; "unknown": a
 *  ratio or product of two columns' units that is not worked out here. */
export function statUnitRule(fn: string): "same" | "none" | "unknown" {
  return SAME_UNIT_AS_FIRST.has(fn) ? "same" : UNITLESS.has(fn) ? "none" : "unknown";
}
