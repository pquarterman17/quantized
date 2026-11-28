// Which derived columns (Set Column Values, the worksheet ƒx bar: a step
// recorded with `derived: true`, store/derivedColumnRun.ts) the exported Python
// script can reproduce, and what it carries for them.
//
// "Derived" adds three things to a plain formula column, and only the first
// two are values-neutral:
//   - a UNIT, worked out by the app from the operands' units (lib/derivedUnits).
//     The script cannot redo that algebra, so the app records the unit it
//     computed (`unit`, with the formula it was computed for, `unitExpr`) and
//     the script writes it with `qz.add_formula_columns`' `{"unit": ...}` form;
//   - fitted-value references, fit("Model", "p"): a snapshot of a fit held in
//     the app, so they stay app-only (as the plain formula check already says
//     of quoted text, here with the specific reason);
//   - a propagated σ column (`propagate`): quantized.api has no first-order
//     propagation, so it stays app-only.
// Fail closed: a step recorded before the unit was kept says so and is not run.

import type { PipelineStep } from "./pipelineStep";

const FIT_REF = /\bfit(val)?\s*\(/;

export interface DerivedExport {
  /** Why the step cannot be exported. */
  unmapped?: string;
  /** The unit the script writes ("" for none). */
  unit?: string;
  /** A comment line for the script. */
  note?: string;
}

/** What the exporter does with a derived step (see the module doc). */
export function derivedExport(p: PipelineStep["params"]): DerivedExport {
  if (p.propagate === true) return { unmapped: "its propagated error column is evaluated only in the app (quantized.api has no error propagation)" };
  if (typeof p.expr === "string" && FIT_REF.test(p.expr)) return { unmapped: "it reads a fitted value, fit(), a snapshot of a fit held in the app" };
  if (typeof p.unit !== "string") return { unmapped: "it was recorded before its unit was kept, so the script cannot say which unit the app gave it" };
  if (p.unitExpr !== p.expr) return { unmapped: "its formula was edited after the app worked out its unit" };
  return p.allowUnitMismatch === true
    ? { unit: p.unit, note: "the app added this column WITHOUT a unit: its operands' units contradicted each other" }
    : { unit: p.unit };
}

/** The Python for one `formulas.append(...)` argument: a (name, expression) pair, or, for a column that has a
 *  unit, the `{"name", "expr", "unit"}` form `qz.add_formula_columns` reads. (A JSON string is a Python one.) */
export function formulaEntry(name: unknown, expr: unknown, d: DerivedExport | null): string {
  const [n, e] = [JSON.stringify(name), JSON.stringify(expr)];
  return d?.unit ? `{"name": ${n}, "expr": ${e}, "unit": ${JSON.stringify(d.unit)}}` : `(${n}, ${e})`;
}
