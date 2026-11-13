// Origin-like references for the worksheet formula language (worksheet audit
// #17). formula.ts sits at its line ceiling — and the eager bundle at its
// budget — so the new forms live here, in a LAZY chunk that registers itself
// with lib/formulaExt.ts on load, and plug into formula.ts's parser through
// the same `ParserOps` capability interface the row-aware forms use
// (lib/formulaRowFns.ts).
//
// What is added (every one was a syntax error before, so no formula that
// already parsed changes meaning):
//
//   col(A)               the same as A (a reference to A, for the column-shift
//                        rewrite and the dependency list alike).
//   col("Long Name")     the column whose NAME is "Long Name". Resolved to its
//                        letter when the formula is added (`resolveColumnNames`),
//                        so a later rename or move follows the column like any
//                        letter reference. Exact name first, then a unique
//                        case-insensitive match.
//   c ? a : b            the conditional, exactly `if(c, a, b)` (formula.ts).
//   A[i]                 column A at row i — 1-BASED like the grid's row
//                        numbers (A[1] is the first row); `i` may be any
//                        expression (A[row() - 1] is the previous row). Out of
//                        range, or a non-integer i, is NaN.
//   sum(A[i:j])          an aggregate over rows i..j, 1-based and INCLUSIVE
//                        at both ends (A[1:10] is the first ten rows) — every
//                        aggregate (mean/sd/min/max/median/sum/count) takes a
//                        range. A range is only meaningful inside one.
//   cumsum(A)            running sum of A down to this row. A blank (NaN) cell
//                        adds nothing to the running total but is itself NaN.
//   sheet("Name", A)     column A (or x) of the worksheet named "Name", at the
//                        same row (NaN past its last row) — the simpler,
//                        documented form of Origin's [Book]Sheet!col(A). The
//                        worksheet is found by its name in the Library. A
//                        formula reading another worksheet is recalculated when
//                        that worksheet changes (lib/recalc.ts edges).
//   A == "text"          text comparison: A categorical -> its row's LEVEL
//   col("T") != "text"   label; a text column (named with col("…")) -> its
//                        cell. Only == and != compare text (case-sensitive,
//                        surrounding spaces ignored); the result is 1/0, NaN
//                        for a missing categorical code.
//   rowmean(A, B, …)     row statistics ACROSS columns (worksheet audit #19):
//   rowsd rowmin rowmax  blank (NaN) cells are skipped; with none left the
//   rowsum rown          result is NaN (rown is then 0); rowsd is the sample
//                        SD (n − 1), NaN below 2 values.

import { applyFormulasWithErrors, baseColumns, channelLetter } from "./formula";
import { AGGREGATE_NAMES, computeAggregate, type AggregateName } from "./formulaAggregates";
import { registerFormulaExtension } from "./formulaExt";
import { tokenize } from "./formulaTokenize";
import type { FormulaFn, FormulaRowContext, Tok } from "./formulaTypes";
import type { ParserOps } from "./formulaRowFns";
import { textColumnEntries } from "./originTextColumnCells";
import type { DataStruct, Dataset } from "./types";

const isOp = (t: Tok | undefined, v: string): boolean => !!t && t.t === "op" && t.v === v;

// ── col("Long Name") -> letter ──────────────────────────────────────────

/** `expr` with every `col("Name")` naming a value column replaced by that
 *  column's letter. Unmatched names — a text column, or a typo the evaluator
 *  will then report — are left as written. */
export function resolveColumnNames(expr: string, labels: readonly string[]): string {
  let toks: Tok[];
  try {
    toks = tokenize(expr);
  } catch {
    return expr; // the evaluator reports the syntax error itself
  }
  const edits: { from: number; to: number; text: string }[] = [];
  for (let i = 0; i + 3 < toks.length; i++) {
    const [t, open, name, close] = [toks[i], toks[i + 1], toks[i + 2], toks[i + 3]];
    if (!(t.t === "name" && t.v === "col" && isOp(open, "(") && name.t === "str" && isOp(close, ")"))) continue;
    const idx = indexOfName(labels, name.v);
    if (idx < 0 || t.p === undefined || close.p === undefined) continue;
    edits.push({ from: t.p, to: close.p + 1, text: channelLetter(idx) });
  }
  let out = expr;
  for (const e of edits.reverse()) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  return out;
}

function indexOfName(labels: readonly string[], name: string): number {
  const exact = labels.indexOf(name);
  if (exact >= 0) return exact;
  const key = name.trim().toLowerCase();
  const hits = labels.flatMap((l, i) => (l.trim().toLowerCase() === key ? [i] : []));
  return hits.length === 1 ? hits[0] : -1;
}

// ── text comparison ─────────────────────────────────────────────────────

type TextRef = { col: string } | { text: string };

/** At a comparison's start: `A == "x"`, `col("T") != "x"`, or the reverse.
 *  Consumes the whole comparison and returns it, or returns undefined having
 *  consumed nothing (an ordinary numeric comparison). */
export function tryParseTextCompare(ops: ParserOps): FormulaFn | undefined {
  const refLen = (at: number): number => {
    const t = ops.peekAt(at);
    if (t?.t === "name" && t.v === "col" && isOp(ops.peekAt(at + 1), "(") && ops.peekAt(at + 2)?.t === "str" && isOp(ops.peekAt(at + 3), ")")) return 4;
    if (t?.t === "name" && t.v !== "col" && !isOp(ops.peekAt(at + 1), "(") && !isOp(ops.peekAt(at + 1), "[")) return 1;
    return 0;
  };
  const isEq = (at: number) => isOp(ops.peekAt(at), "==") || isOp(ops.peekAt(at), "!=");
  let ref: TextRef;
  let value: string;
  let op: string;
  const left = refLen(0);
  if (left && isEq(left) && ops.peekAt(left + 1)?.t === "str") {
    ref = readRef(ops, left);
    op = ops.eat().v as string;
    value = (ops.eat() as Extract<Tok, { t: "str" }>).v;
  } else if (ops.peek()?.t === "str" && isEq(1) && refLen(2)) {
    value = (ops.eat() as Extract<Tok, { t: "str" }>).v;
    op = ops.eat().v as string;
    ref = readRef(ops, refLen(0));
  } else {
    return undefined;
  }
  // Reads the row's level table / text cells, which a single-row incremental
  // recompute (lib/formulaIncremental.ts) does not supply: report it as not
  // row-local so that path falls back to a full recompute.
  ops.nonLocal("aggregate");
  const want = value.trim();
  return (c, ex) => {
    const got = textAt(ref, c, ex);
    if (got === null) return NaN;
    return (got === want) === (op === "==") ? 1 : 0;
  };
}

function readRef(ops: ParserOps, len: number): TextRef {
  if (len === 1) {
    const name = (ops.eat() as Extract<Tok, { t: "name" }>).v;
    ops.ref(name);
    return { col: name };
  }
  ops.eat(); // col
  ops.eat(); // (
  const text = (ops.eat() as Extract<Tok, { t: "str" }>).v;
  ops.eat(); // )
  return { text };
}

function textAt(ref: TextRef, c: Record<string, number>, ex: FormulaRowContext | undefined): string | null {
  if (!ex) throw new Error("text comparison has no row context to evaluate against");
  if ("text" in ref) {
    const cells = ex.text?.[ref.text];
    if (!cells) throw new Error(`no column named "${ref.text}"`);
    return String(cells[ex.row] ?? "").trim();
  }
  const levels = ex.levels?.[ref.col];
  if (!levels) {
    if (c[ref.col] === undefined) throw new Error(`unknown variable "${ref.col}"`);
    throw new Error(`${ref.col} is a numeric column; compare it with a number, not text`);
  }
  const code = c[ref.col];
  return Number.isInteger(code) && code >= 0 && code < levels.length ? levels[code].trim() : null;
}

// ── A[i] and aggregate ranges ───────────────────────────────────────────

const atRow = (arr: readonly number[] | undefined, oneBased: number, col: string): number => {
  if (!arr) throw new Error(`unknown variable "${col}"`);
  return Number.isInteger(oneBased) && oneBased >= 1 && oneBased <= arr.length ? arr[oneBased - 1] : NaN;
};

/** After a bare column name, with `[` next: `A[i]` (a scalar). A range
 *  `A[i:j]` outside an aggregate is refused with what to write instead. */
export function parseIndexSuffix(col: string, ops: ParserOps): FormulaFn {
  ops.nonLocal("lag"); // reads a row other than the one being evaluated
  ops.expectOp("[");
  const index = ops.parseExpr();
  if (isOp(ops.peek(), ":")) throw new Error(`${col}[i:j] is a range of rows; use it inside an aggregate, e.g. sum(${col}[i:j])`);
  ops.expectOp("]");
  return (c, ex) => {
    if (!ex) throw new Error(`${col}[…] has no row context to evaluate against`);
    return atRow(ex.columns[col], index(c, ex), col);
  };
}

/** Inside `agg(`: a bare column with a `[i:j]` range, then `)`. Returns
 *  undefined (nothing consumed) when the argument is not that shape. */
function tryParseAggregateRange(fname: string, ops: ParserOps, consts: Record<string, number>): FormulaFn | undefined {
  const first = ops.peek();
  if (!AGGREGATE_NAMES.has(fname) || first?.t !== "name" || first.v in consts || !isOp(ops.peekAt(1), "[")) return undefined;
  ops.nonLocal("aggregate");
  const col = (ops.eat() as Extract<Tok, { t: "name" }>).v;
  ops.ref(col);
  ops.expectOp("[");
  const from = ops.parseExpr();
  ops.expectOp(":");
  const to = ops.parseExpr();
  ops.expectOp("]");
  ops.expectOp(")");
  const name = fname as AggregateName;
  // One reduction per (column array, range): every row of a recompute passes
  // the same array, and a constant range is the overwhelmingly common case.
  const memo = new WeakMap<readonly number[], Map<string, number>>();
  return (c, ex) => {
    if (!ex) throw new Error(`${fname}() has no row context to evaluate against`);
    const arr = ex.columns[col];
    if (!arr) throw new Error(`unknown variable "${col}"`);
    const [i, j] = [from(c, ex), to(c, ex)];
    if (!Number.isInteger(i) || !Number.isInteger(j)) return NaN;
    const key = `${i}:${j}`;
    let cache = memo.get(arr);
    if (!cache) memo.set(arr, (cache = new Map()));
    let v = cache.get(key);
    if (v === undefined) cache.set(key, (v = computeAggregate(name, arr.slice(Math.max(0, i - 1), Math.max(0, j)))));
    return v;
  };
}

// ── cumsum(A), sheet("Name", A), and a col("…") left unresolved ────────

/** `cumsum(`, `sheet(` or `col(` after the name and `(` were eaten. */
function tryParseRefCall(fname: string, ops: ParserOps): FormulaFn | undefined {
  if (fname === "cumsum") {
    ops.nonLocal("aggregate");
    const t = ops.eat();
    if (t?.t !== "name" || !isOp(ops.peek(), ")")) throw new Error("cumsum() expects a bare column name, e.g. cumsum(A)");
    ops.ref(t.v);
    ops.expectOp(")");
    const col = t.v;
    const memo = new WeakMap<readonly number[], number[]>();
    return (_c, ex) => {
      if (!ex) throw new Error("cumsum() has no row context to evaluate against");
      const arr = ex.columns[col];
      if (!arr) throw new Error(`unknown variable "${col}"`);
      let sums = memo.get(arr);
      if (!sums) {
        let total = 0;
        sums = arr.map((v) => (Number.isFinite(v) ? (total += v) : NaN));
        memo.set(arr, sums);
      }
      return sums[ex.row] ?? NaN;
    };
  }
  if (fname === "sheet") {
    const name = ops.eat();
    if (name?.t !== "str") throw new Error('sheet() expects a worksheet name in quotes, e.g. sheet("Run 2", A)');
    ops.expectOp(",");
    const col = ops.eat();
    if (col?.t !== "name") throw new Error('sheet() expects a column letter after the name, e.g. sheet("Run 2", A)');
    ops.expectOp(")");
    ops.nonLocal("aggregate"); // reads another worksheet: never incremental
    // NOT ops.ref(): the letter names a column of ANOTHER worksheet, so the
    // column-shift rewrite and this sheet's dependency list must not see it.
    return (_c, ex) => {
      const cols = ex?.sheet?.(name.v);
      if (!cols) throw new Error(`no worksheet named "${name.v}"`);
      const arr = cols[col.v];
      if (!arr) throw new Error(`worksheet "${name.v}" has no column ${col.v}`);
      return ex && ex.row < arr.length ? arr[ex.row] : NaN;
    };
  }
  if (fname === "col") {
    const t = ops.peek();
    if (t?.t === "name" && isOp(ops.peekAt(1), ")")) {
      ops.eat();
      ops.ref(t.v);
      ops.expectOp(")");
      return (c) => {
        const v = c[t.v];
        if (v === undefined) throw new Error(`unknown variable "${t.v}"`);
        return v;
      };
    }
    throw new Error(t?.t === "str" ? `no column named "${t.v}"` : 'col() expects a column letter or a name in quotes, e.g. col(A) or col("Moment")');
  }
  return undefined;
}

// ── the evaluation context ──────────────────────────────────────────────

type SheetData = Pick<DataStruct, "time" | "values" | "labels">;
let sheetResolver: ((name: string) => SheetData | undefined) | null = null;

/** How `sheet("Name", …)` finds a worksheet (by its Library name): the store
 *  registers it when this module loads (store/computedColumns.ts). */
export function setFormulaSheetResolver(resolve: ((name: string) => SheetData | undefined) | null): void {
  sheetResolver = resolve;
}

/** The text/level/other-sheet parts of a formula's row context. */
export function rowContextExtras(
  metadata: DataStruct["metadata"],
  labels: readonly string[],
  catLevels: Record<number, readonly string[]>,
): Pick<FormulaRowContext, "levels" | "text" | "sheet"> {
  const levels: Record<string, readonly string[]> = {};
  for (const [i, table] of Object.entries(catLevels)) if (Number(i) < labels.length) levels[channelLetter(Number(i))] = table;
  const text: Record<string, readonly string[]> = {};
  // Converted on first read only: most formulas never compare text.
  for (const [name, cells] of textColumnEntries({ metadata })) {
    let rows: readonly string[] | undefined;
    Object.defineProperty(text, name, { enumerable: true, get: () => (rows ??= cells.map((c) => String(c ?? ""))) });
  }
  const cache = new Map<string, Record<string, readonly number[]> | undefined>();
  const sheet = (name: string) => {
    if (!cache.has(name)) {
      const ds = sheetResolver?.(name);
      const cols: Record<string, readonly number[]> | undefined = ds ? { x: ds.time } : undefined;
      if (ds && cols) ds.labels.forEach((_, c) => (cols[channelLetter(c)] = ds.values.map((row) => row[c])));
      cache.set(name, cols);
    }
    return cache.get(name);
  };
  return { levels, text, sheet };
}

// ── row statistics across columns (audit #19) ───────────────────────────

const finiteOf = (a: number[]): number[] => a.filter((v) => Number.isFinite(v));
const sumOf = (a: number[]): number => a.reduce((s, v) => s + v, 0);

export const ROW_FUNCS: Record<string, (...a: number[]) => number> = {
  rowmean: (...a) => ((f) => (f.length ? sumOf(f) / f.length : NaN))(finiteOf(a)),
  rowsd: (...a) => {
    const f = finiteOf(a);
    if (f.length < 2) return NaN;
    const m = sumOf(f) / f.length;
    return Math.sqrt(sumOf(f.map((v) => (v - m) ** 2)) / (f.length - 1));
  },
  rowmin: (...a) => ((f) => (f.length ? Math.min(...f) : NaN))(finiteOf(a)),
  rowmax: (...a) => ((f) => (f.length ? Math.max(...f) : NaN))(finiteOf(a)),
  rowsum: (...a) => ((f) => (f.length ? sumOf(f) : NaN))(finiteOf(a)),
  rown: (...a) => finiteOf(a).length,
};

/** Every dataset with a formula error — one compiled before this module
 *  loaded reports EXTENSION_PENDING, or a plain syntax error for a text
 *  comparison (lib/formulaExt.ts) — recomputed; the others unchanged (same
 *  object). The store calls it once, when this module has loaded. */
export function recomputeExtensionPending(datasets: Dataset[]): Dataset[] {
  return datasets.map((d) => {
    if (!d.formulas || !Object.keys(d.formulaErrors ?? {}).length) return d;
    const { data, errors } = applyFormulasWithErrors(baseColumns(d.data, d.formulas.length), d.formulas);
    return { ...d, data, formulaErrors: Object.keys(errors).length ? errors : undefined };
  });
}

registerFormulaExtension({
  parseConditional: (cond, ops) => {
    ops.expectOp("?");
    const a = ops.parseExpr(); // right-associative: a branch may itself be `c ? x : y`
    ops.expectOp(":");
    const b = ops.parseExpr();
    return (c, ex) => ((cv) => (Number.isNaN(cv) ? NaN : cv !== 0 ? a(c, ex) : b(c, ex)))(cond(c, ex));
  },
  tryParseTextCompare,
  parseIndexSuffix,
  tryParseCall: (fname, ops, consts) => tryParseRefCall(fname, ops) ?? tryParseAggregateRange(fname, ops, consts),
  resolveColumnNames,
  rowContextExtras,
  funcs: ROW_FUNCS,
});
