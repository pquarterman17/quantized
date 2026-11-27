// `rng("Name")` in the formula language (ROW_RANGE_CONTRACT 5.2, slice R4b): the parse and the evaluation. The link and
// rename model is lib/rangeRefs.ts; lib/formulaRefs.ts registers this with lib/formulaExt.ts.
//
//   mean(rng("Baseline"))        an aggregate over the rows and the column of a named range (a block of ONE worksheet)
//   sum(rng("Fit window", 2))    the 2nd column of a wider range (1-based, a literal)
//
// It is legal only as the argument of an aggregate (mean sd min max median sum count), where `A[i:j]` is already the
// only legal range; anywhere else it is an error saying so. Rows are the range's POSITIONS on the raw worksheet (the
// exclusion mask and data filter do not apply, as they do not to `A[i:j]`); a block past the end of the sheet is an
// error, never clamped.
//
// A block on the formula's OWN worksheet is read from the worksheet's columns AS THEY ARE BEING COMPUTED, so an edit
// (or an insert, a delete) recalculates against the new cells and not the stored ones. The formula only sees columns to
// its LEFT, like a column letter does; a range reaching a later column is an error saying so.

import { channelLetter } from "./formula";
import { AGGREGATE_NAMES, computeAggregate, type AggregateName } from "./formulaAggregates";
import type { ParserOps } from "./formulaRowFns";
import type { FormulaFn, FormulaRowContext, Tok } from "./formulaTypes";
import type { NamedRange } from "./namedRanges";
import { applyFormulasWithErrors, baseColumns } from "./formula";
import { installRangeSource, namedRangeList, rangeColumn, rangeProblem, rangeReaderIds } from "./rangeRefs";
import { rowRangeRefusal } from "./rowRange";
import type { ComputedColumn, Dataset } from "./types";

const isOp = (t: Tok | undefined, v: string): boolean => !!t && t.t === "op" && t.v === v;

/** `agg(rng("Name"[, n]))` after `agg(`; `rng(` anywhere else is refused. undefined (nothing consumed) for any other call. */
export function tryParseRangeCall(fname: string, ops: ParserOps): FormulaFn | undefined {
  if (fname === "rng") throw new Error('rng("Name") is a block of rows: use it inside an aggregate, e.g. mean(rng("Baseline"))');
  const first = ops.peek();
  if (!AGGREGATE_NAMES.has(fname) || first?.t !== "name" || first.v !== "rng" || !isOp(ops.peekAt(1), "(")) return undefined;
  ops.nonLocal("aggregate"); // reads other rows (and perhaps another worksheet): never incremental
  ops.eat();
  ops.eat();
  const name = ops.eat();
  if (name.t !== "str") throw new Error('rng() expects a named range in quotes, e.g. rng("Baseline")');
  let n: number | null = null;
  if (isOp(ops.peek(), ",")) {
    ops.eat();
    const num = ops.eat();
    if (num.t !== "num") throw new Error('rng("Name", n) expects a column number after the name, e.g. rng("Window", 2)');
    n = num.v;
  }
  ops.expectOp(")");
  ops.expectOp(")");
  const agg = fname as AggregateName;
  // One reduction per (block array): every row of a recompute reads the same cached array.
  const memo = new WeakMap<readonly number[], number>();
  return (_c, ex) => {
    if (!ex?.range) throw new Error(`${fname}(rng(…)) has no row context to evaluate against`);
    const arr = ex.range(name.v, n, ex.columns);
    let v = memo.get(arr);
    if (v === undefined) memo.set(arr, (v = computeAggregate(agg, arr)));
    return v;
  };
}

/** The reader behind `FormulaRowContext.range` for formula `f`, over `datasets` (the live list, or a store update's own). */
export function rangeReader(f: ComputedColumn, datasets: readonly Dataset[]): NonNullable<FormulaRowContext["range"]> {
  // The worksheet THIS formula is being computed for: the one whose formula list holds this very column object.
  // Two worksheets holding the SAME column object cannot be told apart, so its block's owner is unknown: refused, never guessed.
  const owners = datasets.filter((d) => d.formulas?.includes(f));
  const owner = owners[0];
  const cache = new Map<string, readonly number[]>();
  return (name, n, columns) => {
    const key = `${name}\u0000${n}`;
    const hit = cache.get(key);
    if (hit) return hit;
    if (owners.length > 1) throw new Error(`this column is shared by ${owners.length} worksheets, so rng("${name}") cannot tell which one it belongs to — re-enter the formula`);
    const binding = f.ranges?.find((b) => b.name === name);
    if (!binding) throw new Error(`rng("${name}") is not linked to a named range — edit the formula to link it`);
    const range: NamedRange | undefined = binding.id === null ? undefined : namedRangeList().find((r) => r.id === binding.id);
    if (!range) throw new Error(`named range "${name}" was removed, so rng("${name}") has nothing to read — edit or remove this column`);
    const problem = rangeProblem(range);
    if (problem) throw new Error(problem);
    const column = rangeColumn(range, n, channelLetter);
    if ("error" in column) throw new Error(column.error);
    const col = range.target.cols[column.index];
    const ds = datasets.find((d) => d.id === range.target.datasetId);
    if (!ds) throw new Error(`the worksheet of named range "${range.name}" no longer exists`);
    const own = owner?.id === ds.id;
    if (ds.pending && !own) throw new Error(`worksheet "${ds.name}" has not loaded its full data yet — open it, then recalculate`);
    const letter = col < 0 ? "x" : channelLetter(col);
    let arr: readonly number[];
    if (own) {
      const inFlight = columns[letter];
      if (!inFlight) throw new Error(`named range "${range.name}" reaches column ${letter}, which is computed after this one: a formula reads only the columns to its left`);
      arr = inFlight;
    } else if (col < 0) arr = ds.data.time;
    else if (col < ds.data.labels.length) arr = ds.data.values.map((row) => row[col]);
    else throw new Error(`named range "${range.name}" reaches column ${letter}, which "${ds.name}" no longer has`);
    const rows = range.target.rows;
    if (rows) {
      const refusal = rowRangeRefusal(rows, arr.length);
      if (refusal) throw new Error(`named range "${range.name}": ${refusal}`);
    }
    const block = rows ? arr.slice(rows.from, rows.to + 1) : arr;
    cache.set(key, block);
    return block;
  };
}

/** The named ranges `ranges` changed: every worksheet with a formula linked to one of `ids` (all of them when undefined)
 *  is re-evaluated against `datasets` and `ranges` (a recompute inside a store update, before it is committed;
 *  `withDatasets` is lib/formulaRefs.ts's `withSheetDatasets`). The same array when no worksheet holds such a formula. */
export function refreshReaders(
  datasets: Dataset[],
  ranges: readonly NamedRange[],
  ids: ReadonlySet<string> | undefined,
  withDatasets: <T>(datasets: readonly Dataset[], fn: () => T) => T,
): Dataset[] {
  const readers = rangeReaderIds(datasets, ids);
  if (!readers.size) return datasets;
  const live = installRangeSource(() => ranges);
  try {
    return withDatasets(datasets, () =>
      datasets.map((d) => {
        if (!readers.has(d.id) || !d.formulas) return d;
        const { data, errors } = applyFormulasWithErrors(baseColumns(d.data, d.formulas.length), d.formulas);
        return { ...d, data, formulaErrors: Object.keys(errors).length ? errors : undefined };
      }),
    );
  } finally {
    installRangeSource(live);
  }
}
