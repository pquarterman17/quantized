// Worksheet computed columns: evaluate a list of formulas over a DataStruct,
// appending one column per formula (the grammar, precedence and NaN rules are
// in lib/formulaParser.ts, which `compileFormula` and `referencedColumns` are
// re-exported from here so no caller changes).
//
// Aggregate / row-scope: applyFormulas / recomputeWithErrors evaluate over
// whatever DataStruct the CALLER hands them — today the dataset's FULL raw row
// set (store/useApp.ts's `recompute`), never the exclusion/filter-pruned
// analysis view; row()/lag()/diff()/the aggregates read that same row set,
// snapshotted once per formula just before its column is appended.

import { formulaExtension } from "./formulaExt";
import { compileFormula } from "./formulaParser";
import type { FormulaFn } from "./formulaTypes";
import { baseColumns, carryComputedLevelOrder, type StrippableData } from "./formulaInputs";
import { computeRecodeAppend } from "./recode";
import type { ComputedColumn, DataStruct } from "./types";

export type { FormulaFn, FormulaRowContext } from "./formulaTypes";
export { computeAggregate, AGGREGATE_NAMES, type AggregateName } from "./formulaAggregates";
export { compileFormula, referencedColumns, tokenize } from "./formulaParser";

// `baseColumns` MOVED to ./formulaInputs (Group O-2): it grew a second
// channel-index-keyed strip when `level_order` joined `cat_levels`, and this
// module sits AT its 500-line ceiling — the same reason `stripChannelKeyed`
// itself already lives there ("purely for headroom", per its own doc). The two
// belong together anyway: one strips the columns, the other strips the
// channel-keyed maps that index them. Re-exported so the 16 call sites across
// the store and workshops need no churn.
export { baseColumns };

/** The shared computation `applyFormulas`/`formulaErrors` both delegate to
 *  (K5b): ONE pass over the formula list, producing the resulting DataStruct
 *  AND the per-column error state side by side, so the two views can never
 *  drift apart. A formula that fails to compile OR whose evaluator throws on
 *  ANY row is recorded in `errors` (keyed by `ComputedColumn.name`, first
 *  failure's message) — but STILL yields its all-NaN column in `data.values`,
 *  keeping the column count stable so downstream channel indices never
 *  shift (unchanged pre-K5 behavior; the error state is a purely additive
 *  companion). Row-aware functions (row/lag/diff/aggregates) see the SAME
 *  rows as the plain scalar context — see the module header's "Aggregate /
 *  row-scope" note for what that means today. */
function computeFormulas(
  base: DataStruct,
  formulas: ComputedColumn[],
): { data: DataStruct; errors: Record<string, string> } {
  if (!formulas.length) return { data: base, errors: {} };
  const labels = [...base.labels];
  const units = [...base.units];
  const values = base.values.map((row) => [...row]);
  const rowCount = base.time.length;
  const errors: Record<string, string> = {};
  // J2: seeded from the base's own categorical channels so a recode can
  // resolve its source's level table, and grown as each recode column is
  // appended (see computeRecodeColumn) so a LATER column may recode an
  // earlier recode column too.
  const catLevels: Record<number, string[]> = base.cat_levels ? { ...base.cat_levels } : {};
  for (const f of formulas) {
    let colValues: number[];
    if (f.recode) {
      // J2: `catLevels` already holds every earlier column's table (base +
      // any prior recode), so a recode may itself recode an earlier recode
      // column — chaining through for free.
      const sourceIdx = labels.findIndex((_, c) => channelLetter(c) === f.recode!.sourceLetter);
      const result = computeRecodeAppend(
        f.recode,
        sourceIdx >= 0 ? catLevels[sourceIdx] : undefined,
        values.map((row) => row[sourceIdx]),
        rowCount,
      );
      colValues = result.codes;
      if (result.levels) catLevels[labels.length] = result.levels; // the column this recode is about to occupy
      if (result.error) errors[f.name] = result.error;
    } else {
      let fn: FormulaFn | null;
      try {
        fn = compileFormula(formulaExtension()?.resolveColumnNames(f.expr, labels) ?? f.expr);
      } catch (e) {
        fn = null;
        errors[f.name] = e instanceof Error ? e.message : "formula failed to compile";
      }
      // P2.5 (lib/formulaTypes.ts DerivedSpec): a σ whose value column no
      // longer links back to it — edited, renamed or removed — is an error.
      const of = f.derived?.sigmaOf;
      if (fn && of && formulas.find((g) => g.name === of.name)?.derived?.sigma !== f.name)
        [fn, errors[f.name]] = [null, `stale σ: "${of.name}" was edited or removed`];
      // One column-array snapshot per formula (not per row): captures `x` plus
      // every channel as of just before THIS formula's own column is appended
      // — exactly what the per-row scalar ctx below also reflects.
      const colSnapshot: Record<string, number[]> = { x: base.time };
      labels.forEach((_, c) => {
        colSnapshot[channelLetter(c)] = values.map((row) => row[c]);
      });
      const extras = formulaExtension()?.rowContextExtras(base.metadata, labels, catLevels, f.sheets);
      colValues = [];
      for (let r = 0; r < rowCount; r++) {
        let v = Number.NaN;
        if (fn) {
          const ctx: Record<string, number> = { x: base.time[r] };
          labels.forEach((_, c) => {
            ctx[channelLetter(c)] = values[r]?.[c];
          });
          try {
            v = fn(ctx, { row: r, rowCount, columns: colSnapshot, fits: f.derived?.fits, ...extras });
          } catch (e) {
            v = Number.NaN;
            // First failing row wins (later rows' errors are usually the same
            // root cause repeated); don't overwrite a compile-time error above.
            if (!errors[f.name]) errors[f.name] = e instanceof Error ? e.message : "formula evaluation failed";
          }
        }
        colValues.push(v);
      }
    }
    for (let r = 0; r < rowCount; r++) values[r].push(colValues[r]);
    if (Array.isArray(f.factor?.levels)) catLevels[labels.length] = [...f.factor.levels]; // P2.5 lib/metadataFactor.ts
    // A mirror of a categorical column carries the source's level table with its codes (one recompute, so they never disagree).
    else if (f.sheets) {
      const mirrored = formulaExtension()?.mirrorLevels(f);
      if (mirrored) catLevels[labels.length] = [...mirrored];
    }
    labels.push(f.name);
    units.push(f.unit ?? "");
  }
  return {
    data: { ...base, labels, units, values, ...(Object.keys(catLevels).length ? { cat_levels: catLevels } : {}) },
    errors,
  };
}

/** Append computed columns to a base DataStruct, evaluating each formula in
 *  order over `x` + the accumulating channels (so a later formula may
 *  reference an earlier computed column). See `computeFormulas` for the
 *  per-column-failure behavior; this wrapper keeps the pre-K5 signature
 *  (data only) for every existing caller. */
export function applyFormulas(base: DataStruct, formulas: ComputedColumn[]): DataStruct {
  return computeFormulas(base, formulas).data;
}

/** The per-column error state (K5b) `applyFormulas` computes but discards —
 *  same single pass, errors only. */
export function formulaErrors(base: DataStruct, formulas: ComputedColumn[]): Record<string, string> {
  return computeFormulas(base, formulas).errors;
}

/** `applyFormulas` + `formulaErrors` from ONE evaluation pass. Calling the two
 *  separately evaluates every formula over every row twice. */
export function applyFormulasWithErrors(
  base: DataStruct,
  formulas: ComputedColumn[],
): { data: DataStruct; errors: Record<string, string> } {
  return computeFormulas(base, formulas);
}

/** Strip the last `formulas.length` stale computed columns from `data` and
 *  reapply, plus the error state (K5b), in one pass — `store/useApp.ts`'s
 *  `recompute` chokepoint. `data` must be `StrippableData`
 *  (lib/formulaInputs.ts): assert via `asAlreadyComputed` ONLY when those
 *  columns are known present — a base-only table has none to strip, and
 *  stripping anyway deletes real columns (#245, #4); use `recomputeFromBase`
 *  there instead. `recomputeData` (bare-`DataStruct`) deleted 2026-08-27. */
export function recomputeWithErrors(
  data: StrippableData,
  formulas: ComputedColumn[],
): { data: DataStruct; errors: Record<string, string> } {
  const out = computeFormulas(baseColumns(data, formulas.length), formulas);
  return { ...out, data: carryComputedLevelOrder(data, out.data) };
}


/** Channel letter for a 0-based index: 0→A, 1→B, … 25→Z, then AA, AB, … */
export function channelLetter(i: number): string {
  let n = i;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}
