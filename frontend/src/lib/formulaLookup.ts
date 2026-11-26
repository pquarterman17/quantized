// Lookup and reference functions of the worksheet formula language (plan item
// 33), after Excel's LOOKUP / XLOOKUP / MATCH / INDEX / OFFSET, on the column
// model: the table arguments are bare column letters (as interp's), rows are
// numbered from 1 (as the grid and A[i]), and a miss is a blank (NaN) cell,
// never a guess. Part of the LAZY formula chunk (lib/formulaWave2.ts).
//
//   lookup(v, X, Y)         Y at the LAST row whose X <= v. X must be ascending
//                           (blank cells skipped); v below every X is blank.
//   xlookup(v, X, Y[, nf])  Y at the FIRST row whose X equals v exactly; none
//                           gives nf (default blank). X may be in any order.
//   match(v, X[, type])     the row number (1-based) of v in X. type 1 (default,
//                           as Excel): last X <= v, X ascending; 0: first exact
//                           match; -1: last X >= v, X descending. No match is blank.
//   index(Y, k)             Y at row k — the function form of Y[k].
//   offset(A, k)            A at THIS row + k (k may be negative; 0 is this row).
//
// ROW SCOPE: as mean(A), they read ex.columns (the dataset's full row set).
// lookup/xlookup/match read whole columns and report non-local (a one-cell edit
// recomputes the column); index/offset read one other row, as A[i] and lag().
// None is in the headless table, so the exporter refuses them.

import { columnArg } from "./formulaSpecial";
import type { ParserOps } from "./formulaRowFns";
import type { FormulaFn, FormulaRowContext, Tok } from "./formulaTypes";

const isOp = (t: Tok | undefined, v: string): boolean => !!t && t.t === "op" && t.v === v;

function column(ex: FormulaRowContext | undefined, fname: string, name: string): readonly number[] {
  if (!ex) throw new Error(`${fname}() has no row context to evaluate against`);
  const arr = ex.columns[name];
  if (!arr) throw new Error(`unknown variable "${name}"`);
  return arr;
}

type Kind = "asc" | "desc" | "exact";
interface Table {
  /** Rows (0-based) with a usable X, in column order. */
  rows: number[];
  xs: number[];
  first?: Map<number, number>;
}

/** Per column array, per kind: the usable rows (and, for "exact", first-hit map).
 *  Every row of a recompute passes the same array, so the scan runs once. */
const tables = new WeakMap<readonly number[], Map<Kind, Table | string>>();

function tableOf(fname: string, xName: string, arr: readonly number[], kind: Kind): Table {
  let byKind = tables.get(arr);
  if (!byKind) tables.set(arr, (byKind = new Map()));
  let t = byKind.get(kind);
  if (t === undefined) {
    const rows: number[] = [];
    const xs: number[] = [];
    arr.forEach((v, r) => {
      if (Number.isNaN(v)) return;
      rows.push(r);
      xs.push(v);
    });
    const table: Table = { rows, xs };
    t = table;
    if (kind === "exact") {
      const first = (table.first = new Map<number, number>());
      xs.forEach((v, i) => first.has(v) || first.set(v, rows[i]));
    } else if (xs.some((v, i) => i > 0 && (kind === "asc" ? v < xs[i - 1] : v > xs[i - 1]))) {
      t = `${fname}(): column ${xName} must be sorted ${kind === "asc" ? "ascending" : "descending"} (blank cells aside); ${kind === "asc" ? "xlookup(), or match(v, X, 0)," : "match(v, X, 0)"} accepts any order`;
    }
    byKind.set(kind, t);
  }
  if (typeof t === "string") throw new Error(t);
  return t;
}

/** Row (0-based) of the last entry with x <= v (asc) or x >= v (desc), or -1. */
function lastWithin(t: Table, v: number, kind: "asc" | "desc"): number {
  let lo = 0;
  let hi = t.xs.length; // first index NOT satisfying
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (kind === "asc" ? t.xs[mid] <= v : t.xs[mid] >= v) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? -1 : t.rows[lo - 1];
}

function parseTableCall(fname: string, ops: ParserOps): FormulaFn {
  ops.nonLocal("aggregate");
  const v = ops.parseExpr();
  ops.expectOp(",");
  const xCol = columnArg(fname, "the X column", ops);
  let yCol = "";
  if (fname !== "match") {
    ops.expectOp(",");
    yCol = columnArg(fname, "the Y column", ops);
  }
  let extra: FormulaFn | undefined;
  if (isOp(ops.peek(), ",") && fname !== "lookup") {
    ops.eat();
    extra = ops.parseExpr();
  }
  ops.expectOp(")");
  return (c, ex) => {
    const xs = column(ex, fname, xCol);
    const ys = yCol ? column(ex, fname, yCol) : xs;
    const at = v(c, ex);
    let row: number;
    if (fname === "lookup" || fname === "match") {
      const type = fname === "match" && extra ? extra(c, ex) : 1;
      if (type !== 1 && type !== 0 && type !== -1) {
        if (Number.isNaN(type)) return NaN;
        throw new Error("match(): the type must be 1 (ascending), 0 (exact) or -1 (descending)");
      }
      if (Number.isNaN(at)) return NaN;
      row = type === 0 ? (tableOf(fname, xCol, xs, "exact").first!.get(at) ?? -1) : lastWithin(tableOf(fname, xCol, xs, type === 1 ? "asc" : "desc"), at, type === 1 ? "asc" : "desc");
    } else {
      row = Number.isNaN(at) ? -1 : (tableOf(fname, xCol, xs, "exact").first!.get(at) ?? -1);
    }
    if (fname === "match") return row < 0 ? NaN : row + 1;
    if (row >= 0) return ys[row] ?? NaN;
    return fname === "xlookup" && extra ? extra(c, ex) : NaN;
  };
}

/** `index(Y, k)` / `offset(A, k)`. */
function parseRowCall(fname: string, ops: ParserOps): FormulaFn {
  ops.nonLocal("lag"); // reads a row other than the one being evaluated
  const col = columnArg(fname, "the column", ops);
  ops.expectOp(",");
  const k = ops.parseExpr();
  ops.expectOp(")");
  return (c, ex) => {
    const arr = column(ex, fname, col);
    const n = k(c, ex);
    if (!Number.isInteger(n)) return NaN;
    const idx = fname === "index" ? n - 1 : ex!.row + n;
    return idx >= 0 && idx < arr.length ? arr[idx] : NaN;
  };
}

/** `fname(` (name and paren already eaten) as one of these forms, or undefined. */
export function tryParseLookupCall(fname: string, ops: ParserOps): FormulaFn | undefined {
  if (fname === "lookup" || fname === "xlookup" || fname === "match") return parseTableCall(fname, ops);
  if (fname === "index" || fname === "offset") return parseRowCall(fname, ops);
  return undefined;
}
