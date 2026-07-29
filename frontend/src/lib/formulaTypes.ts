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
}

export type FormulaFn = (ctx: Record<string, number>, rowCtx?: FormulaRowContext) => number;

export type Tok = { t: "num"; v: number } | { t: "name"; v: string } | { t: "op"; v: string };

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
