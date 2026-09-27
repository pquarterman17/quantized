// Shared types + pure comparison/logical operators for the worksheet formula
// language (JMP_GAP J11). Split out so formula.ts (the tokenizer + precedence-
// climbing parser) and formulaRowFns.ts (the row-aware special forms: if /
// row / lag / diff / the aggregates) can both depend on them without an
// import cycle between those two. See formula.ts's module header for the
// full grammar, NaN-propagation rules, and the logical-operator-style choice
// (keyword `and`/`or`/`not`, not `&& || !`).

/** Per-row context for the row-aware additions (row/lag/diff/aggregates).
 *  Optional on FormulaFn so every pre-existing arithmetic-only formula (and
 *  every existing call site / test) keeps working with no second argument at
 *  all. */
export interface FormulaRowContext {
  /** 0-based index of the row currently being evaluated. */
  row: number;
  /** Total rows in `columns` (every entry has this length). */
  rowCount: number;
  /** Full column arrays — `x` plus every channel letter, same row order as
   *  the scalar `ctx` values passed alongside this. */
  columns: Record<string, number[]>;
  /** P2.5: the fitted values this column was resolved against
   *  (`ComputedColumn.derived.fits`) — what `fit()` / `fitval()` read. */
  fits?: readonly FitRefSnapshot[];
}

export type FormulaFn = (ctx: Record<string, number>, rowCtx?: FormulaRowContext) => number;

/** `p` = 0-based start offset in the source (positioned syntax errors). */
export type Tok = ({ t: "num"; v: number } | { t: "name"; v: string } | { t: "op"; v: string } | { t: "str"; v: string }) & {
  p?: number;
};

/** P2.5 fitted-value use: one saved fit a computed column reads, SNAPSHOTTED
 *  onto the column so recompute stays a pure function of (data, formulas).
 *  Kept current by `lib/derivedFitRefs.refreshFitRefs`, scheduled a tick after
 *  the dataset's fit changes; `missing` says why it cannot be used now (no fit, a
 *  different model, not converged), and evaluation then refuses. Only the
 *  dataset's OWN saved fit (`Dataset.fitSpec`) can be referenced. */
export interface FitRefSnapshot {
  model: string;
  paramNames: string[];
  params: number[];
  /** The model in formula language over `x` and `p0..pn` (fitval() only). */
  expr?: string;
  missing?: string;
}

/** P2.5 derived-expression provenance on a computed column (lib/derivedColumn.ts). */
export interface DerivedSpec {
  /** `unit` was derived from the operand units, not typed by the user. */
  unitAuto?: boolean;
  /** What was assumed at derivation (unknown operand units, exact inputs, …). */
  notes?: string[];
  fits?: FitRefSnapshot[];
  /** The propagated-uncertainty LINK, held on both ends: the value column
   *  names its σ column (`sigma`), the σ column names its value column
   *  (`sigmaOf`). Editing the value column's formula drops its `derived`
   *  (store/computedColumns.updateFormula), and removing or renaming either
   *  end breaks the pair — every one of those makes the σ column an error
   *  (lib/formula.ts), never a σ silently mismatched to its values. A removal
   *  that merely shifts column letters keeps the pair. */
  sigma?: string;
  sigmaOf?: { name: string; method: "first-order, uncorrelated" };
}

export const COMPARE_OPS: ReadonlySet<string> = new Set(["<", "<=", ">", ">=", "==", "!="]);

/** NaN if either operand is NaN, else 1/0. */
export function applyCompare(op: string, a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  switch (op) {
    case "<":
      return a < b ? 1 : 0;
    case "<=":
      return a <= b ? 1 : 0;
    case ">":
      return a > b ? 1 : 0;
    case ">=":
      return a >= b ? 1 : 0;
    case "==":
      return a === b ? 1 : 0;
    case "!=":
      return a !== b ? 1 : 0;
    default:
      throw new Error(`bad comparison operator "${op}"`);
  }
}

export const applyNot = (a: number): number => (Number.isNaN(a) ? NaN : a === 0 ? 1 : 0);
export const applyAnd = (a: number, b: number): number =>
  Number.isNaN(a) || Number.isNaN(b) ? NaN : a !== 0 && b !== 0 ? 1 : 0;
export const applyOr = (a: number, b: number): number =>
  Number.isNaN(a) || Number.isNaN(b) ? NaN : a !== 0 || b !== 0 ? 1 : 0;
