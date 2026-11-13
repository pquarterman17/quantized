// The EAGER half of the Origin-like formula additions (worksheet audit #17).
// The parsing and evaluation live in lib/formulaRefs.ts, a LAZY chunk (the
// eager bundle has no room for them — scripts/check-bundle-size.mjs), which
// registers itself here when it loads. The store starts that load at creation
// (store/computedColumns.ts), so in practice it is there before anyone types
// a formula; until then a formula using the new syntax reports
// EXTENSION_PENDING and is recalculated the moment the module arrives.
//
// Telling every new shape apart before the module arrives would cost eager
// bytes, so only `A[…]` and `c ? a : b` say EXTENSION_PENDING; cumsum/sheet/
// col/row* report "unknown function", and a text comparison or a ranged
// aggregate an ordinary syntax error. Either way it is an error, never a
// value, and the store recomputes every formula that errored once the module
// loads (formulaRefs.recomputeExtensionPending).

import type { ColumnShift } from "./channelRemap";
import type { DataStruct, Dataset, SheetBinding } from "./types";
import type { FormulaFn, FormulaRowContext } from "./formulaTypes";
import type { ParserOps } from "./formulaRowFns";

export interface FormulaExtension {
  /** After `cond`, with `?` next: `cond ? a : b`. */
  parseConditional(cond: FormulaFn, ops: ParserOps): FormulaFn;
  tryParseTextCompare(ops: ParserOps): FormulaFn | undefined;
  parseIndexSuffix(col: string, ops: ParserOps): FormulaFn;
  /** cumsum / sheet / col / an aggregate over a range — undefined when
   *  `fname(` is none of them. */
  tryParseCall(fname: string, ops: ParserOps, consts: Record<string, number>): FormulaFn | undefined;
  resolveColumnNames(expr: string, labels: readonly string[]): string;
  rowContextExtras(
    metadata: DataStruct["metadata"],
    labels: readonly string[],
    catLevels: Record<number, readonly string[]>,
    sheets?: readonly SheetBinding[],
  ): Pick<FormulaRowContext, "levels" | "text" | "sheet">;
  /** Cross-worksheet links (lib/sheetRefs.ts). */
  bindSheets(expr: string, datasets: readonly Dataset[], selfId: string, prior?: readonly SheetBinding[]): { sheets: SheetBinding[] } | { error: string };
  renameSheetRefs(datasets: readonly Dataset[], id: string, newName: string): { datasets: Dataset[]; changed: string[] };
  shiftSheetRefs(datasets: readonly Dataset[], id: string, shift: ColumnShift): { datasets: Dataset[]; changed: string[] };
  /** Evaluate `fn` with `sheet()` reading `datasets` instead of the live
   *  store — for a recompute inside a store update, before it is committed. */
  withSheetDatasets<T>(datasets: readonly Dataset[], fn: () => T): T;
  /** Row statistics across columns: rowmean(A, B, …) etc. */
  funcs: Record<string, (...a: number[]) => number>;
}

let ext: FormulaExtension | null = null;

export const formulaExtension = (): FormulaExtension | null => ext;

export function registerFormulaExtension(e: FormulaExtension): void {
  ext = e;
}

export const EXTENSION_PENDING = "this formula uses Origin-style syntax whose module has not loaded yet; it recalculates as soon as it does";

/** The extension, or the pending error a formula needing it reports. */
export function requireExtension(): FormulaExtension {
  if (!ext) throw new Error(EXTENSION_PENDING);
  return ext;
}

export function loadFormulaExtension(): Promise<typeof import("./formulaRefs")> {
  return import("./formulaRefs");
}
