// Incremental worksheet-formula recompute for a SINGLE-CELL edit (PERF item,
// 2026-09: audit found store/cellEdit.ts's setCellValue/setCategoricalCell
// calling `recompute` — formula.ts's `computeFormulas`, O(rows x formulas) —
// unconditionally after every one-cell edit, even though only one row's base
// values changed). This module evaluates JUST the touched row(s) instead,
// when every formula is provably ROW-LOCAL: its value at row r is a pure
// function of row r's OWN column values, never of the whole column (an
// aggregate — `mean(A)` etc), a NEIGHBOUR row (`lag()`/`diff()`), or a
// column-wide first-appearance level-table scan (a recode). Any formula that
// fails that test makes the whole call bail out (return `null`) so the
// caller falls back to the always-correct, full `recomputeWithErrors` path —
// this is a fast path, never a second source of truth for the computation.
//
// Error-parity note: `computeFormulas`'s "first failing row wins" rule keeps
// whichever exception message was thrown by the first-in-ROW-ORDER row that
// threw, and a stale `formulaErrors` entry records only a MESSAGE, not which
// row produced it — so there is no way to tell whether a newly-thrown
// message at the edited row would out-rank an already-recorded one in row
// order. Rather than guess, a formula that ALREADY has an error before this
// edit forces a bail-out (the `prevErrors` gate below). A formula with NO
// error before the edit stays exactly correct without that caveat: every
// OTHER row's data is unchanged (so it's still error-free), meaning if the
// edited row now throws, it is the only — hence first — failing row in the
// whole column.
//
// row()/if/arithmetic/comparisons/logicals are all row-local: row()/rowCount
// never change from a single-cell edit, and every other operator/function
// here only ever reads the CURRENT row's own ctx values.

import { compileFormula, channelLetter } from "./formula";
import type { StrippableData } from "./formulaInputs";
import type { ComputedColumn, DataStruct } from "./types";

/** Test-only instrumentation: counts each per-row formula evaluation this
 *  module performs, so a test can assert the load-invariant property
 *  "evaluations per single-cell edit == formulas.length" (not rows x
 *  formulas) without depending on wall-clock timing (docs/testing.md).
 *  Production code never reads this — a pure side channel for tests. */
export const formulaEvalCounter = {
  n: 0,
  reset(): void {
    this.n = 0;
  },
};

/** Does `f` depend only on its own row? `false` for a recode (global level-
 *  table order) or a compile failure (conservative — and moot in practice:
 *  a compile-failing formula already has a `formulaErrors` entry, which
 *  `computeFormulasIncremental`'s `prevErrors` gate bails out on anyway). */
export function isRowLocalFormula(f: ComputedColumn): boolean {
  if (f.recode) return false;
  let local = true;
  try {
    compileFormula(f.expr, undefined, () => {
      local = false;
    });
  } catch {
    return false;
  }
  return local;
}

/** Recompute `formulas` for ONLY `changedRows` of `prevFull` — a dataset's
 *  own `.data`, whose BASE columns already carry the edit (the caller
 *  patches those before calling this) but whose COMPUTED columns (the last
 *  `formulas.length`) are still the PRE-edit values — exactly the shape
 *  `store/useApp.ts`'s `recompute`/`asAlreadyComputed` already assumes.
 *  Returns `null` when any formula isn't safely incremental (see this
 *  module's header) — the caller's cue to fall back to a full recompute.
 *  Never mutates `prevFull`: copy-on-write, one new outer `values` array,
 *  a fresh row array only for each row in `changedRows`. */
export function computeFormulasIncremental(
  prevFull: StrippableData,
  formulas: readonly ComputedColumn[],
  changedRows: Iterable<number>,
  prevErrors: Record<string, string> | undefined,
): { data: DataStruct; errors: Record<string, string> } | null {
  if (!formulas.length) return { data: prevFull, errors: {} };
  if (formulas.some((f) => prevErrors?.[f.name] || !isRowLocalFormula(f))) return null;

  const baseCount = prevFull.labels.length - formulas.length;
  // Every formula already passed `isRowLocalFormula` above, so each compiles
  // cleanly here too — `compileFormula` depends only on the expr STRING,
  // never on data, so success/failure can't have changed between the two
  // calls.
  const fns = formulas.map((f) => compileFormula(f.expr));

  const values = prevFull.values.slice();
  const errors: Record<string, string> = {};
  for (const row of changedRows) {
    const rowArr = prevFull.values[row].slice();
    const ctx: Record<string, number> = { x: prevFull.time[row] };
    for (let c = 0; c < baseCount; c++) ctx[channelLetter(c)] = rowArr[c];
    for (let i = 0; i < formulas.length; i++) {
      const col = baseCount + i;
      let v = Number.NaN;
      try {
        formulaEvalCounter.n++;
        // Row-local formulas never read `ex.columns` (only lag/diff/
        // aggregates do, and those are excluded by isRowLocalFormula) — an
        // empty object is safe and skips building a per-row column snapshot.
        v = fns[i](ctx, { row, rowCount: prevFull.time.length, columns: {} });
      } catch (e) {
        if (!errors[formulas[i].name]) {
          errors[formulas[i].name] = e instanceof Error ? e.message : "formula evaluation failed";
        }
      }
      rowArr[col] = v;
      ctx[channelLetter(col)] = v; // a later formula may reference an earlier computed column
    }
    values[row] = rowArr;
  }
  return { data: { ...prevFull, values }, errors };
}
