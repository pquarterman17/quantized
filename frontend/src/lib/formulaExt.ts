// The EAGER half of the Origin-like formula additions (worksheet audit #17).
// The parsing and evaluation live in lib/formulaRefs.ts, a LAZY chunk (the
// eager bundle has no room for them — scripts/check-bundle-size.mjs), which
// registers itself here when it loads. The store starts that load at creation
// (store/computedColumns.ts), so in practice it is there before anyone types
// a formula; until then a formula using the new syntax reports
// EXTENSION_PENDING and is recalculated the moment the module arrives.
//
// Also here, because eager code needs it without the parser: `sheetNamesRead`
// for the recalc graph.
//
// Telling every new shape apart before the module arrives would cost eager
// bytes, so only `A[…]` and `c ? a : b` say EXTENSION_PENDING; cumsum/sheet/
// col/row* report "unknown function", and a text comparison or a ranged
// aggregate an ordinary syntax error. Either way it is an error, never a
// value, and the store recomputes every formula that errored once the module
// loads (formulaRefs.recomputeExtensionPending).

import type { DataStruct } from "./types";
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
  ): Pick<FormulaRowContext, "levels" | "text" | "sheet">;
  /** Row statistics across columns: rowmean(A, B, …) etc. */
  funcs: Record<string, (...a: number[]) => number>;
}

let ext: FormulaExtension | null = null;

export const formulaExtension = (): FormulaExtension | null => ext;

export function registerFormulaExtension(e: FormulaExtension): void {
  ext = e;
}

export const EXTENSION_PENDING = "formula module still loading; recalculates when ready";

/** The extension, or the pending error a formula needing it reports. */
export function requireExtension(): FormulaExtension {
  if (!ext) throw new Error(EXTENSION_PENDING);
  return ext;
}

export function loadFormulaExtension(): Promise<typeof import("./formulaRefs")> {
  return import("./formulaRefs");
}

/** The worksheet names a formula reads through `sheet("Name", …)`. */
export function sheetNamesRead(expr: string): string[] {
  const out = new Set<string>();
  for (const m of expr.matchAll(/\bsheet\s*\(\s*(["'])(.*?)\1/g)) out.add(m[2]);
  return [...out];
}
