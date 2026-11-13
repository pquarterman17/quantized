// The EAGER half of the Origin-like formula additions (worksheet audit #17).
// The parsing and evaluation live in lib/formulaRefs.ts, a LAZY chunk (the
// eager bundle has no room for them — scripts/check-bundle-size.mjs), which
// registers itself here when it loads. The store starts that load at creation
// (store/computedColumns.ts), so in practice it is there before anyone types
// a formula; until then a formula using the new syntax reports
// EXTENSION_PENDING and is recalculated the moment the module arrives. If the
// chunk FAILS to load, the store says so (status + a toast with Retry), and
// the next formula evaluation retries it on its own.
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

/** The loaded extension, or null. Asking while it is NOT loaded and no load
 *  is in flight starts one (quietly, at most every RETRY_MS): a formula
 *  evaluation is the natural moment to retry a chunk that failed to load. */
export function formulaExtension(): FormulaExtension | null {
  if (!ext && !loading && Date.now() - lastFailure >= RETRY_MS) void loadFormulaExtension(true).catch(() => undefined);
  return ext;
}

export function registerFormulaExtension(e: FormulaExtension): void {
  ext = e;
}

export const EXTENSION_PENDING = "this formula uses Origin-style syntax whose module has not loaded yet; it recalculates as soon as it does";

/** The extension, or the pending error a formula needing it reports. */
export function requireExtension(): FormulaExtension {
  if (!ext) throw new Error(EXTENSION_PENDING);
  return ext;
}

type FormulaModule = typeof import("./formulaRefs");

/** Minimum gap between automatic reload attempts after a failure. */
export const RETRY_MS = 3000;
let loading: Promise<FormulaModule> | null = null;
let lastFailure = -Infinity;
let hooks: { loaded: (m: FormulaModule) => void; failed: (quiet: boolean) => void } | null = null;

/** What the store does when the module arrives (register its dataset list,
 *  recompute the formulas that were waiting) and when a load fails (say so,
 *  with a Retry) — set once, at store creation (store/computedColumns.ts). */
export function onFormulaExtension(h: typeof hooks): void {
  hooks = h;
}

/** Load the lazy formula module (one load in flight at a time). A failure —
 *  a chunk that would not download — is reported through the `failed` hook
 *  and leaves the next call free to try again; `quiet` marks an automatic
 *  retry, which the hook does not announce a second time. */
export function loadFormulaExtension(quiet = false): Promise<FormulaModule> {
  return (loading ??= import("./formulaRefs").then(
    (m) => {
      hooks?.loaded(m);
      return m;
    },
    (e: unknown) => {
      loading = null;
      lastFailure = Date.now();
      hooks?.failed(quiet);
      throw e;
    },
  ));
}
