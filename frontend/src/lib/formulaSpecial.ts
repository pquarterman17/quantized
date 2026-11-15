// The row-aware special functions of gap audit 4 (G3) — `rnd(seed)`,
// `normal(seed)` and `interp(v, X, Y)` — parsed against formula.ts's token
// stream through the same ParserOps capability the other forms use. Part of the
// LAZY formula chunk: lib/formulaRefs.ts calls `tryParseSpecialCall` from its
// `tryParseCall`. The numerics, and what each one agrees with in numpy, are
// lib/formulaMath.ts.

import { interpAt, interpTable, Mt19937, seedProblem, type InterpTable, type RandomKind } from "./formulaMath";
import type { FormulaFn, Tok } from "./formulaTypes";
import type { ParserOps } from "./formulaRowFns";

const isOp = (t: Tok | undefined, v: string): boolean => !!t && t.t === "op" && t.v === v;

/** A bare column name (or `x`) as the whole argument, reported as a reference. */
function columnArg(fname: string, what: string, ops: ParserOps): string {
  const t = ops.peek();
  const next = ops.peekAt(1);
  if (t?.t !== "name" || !(isOp(next, ",") || isOp(next, ")")))
    throw new Error(`${fname}() expects ${what} as a bare column letter, e.g. ${fname}(x, A, B)`);
  ops.eat();
  ops.ref(t.v);
  return t.v;
}

/** `rnd(seed)` / `normal(seed)`: draw `row` of RandomState(seed)'s sequence.
 *  Row-local — the value depends only on the row and the seed — so it does
 *  not mark itself non-local (a one-cell edit cannot change it). */
function parseRandom(kind: RandomKind, fname: string, ops: ParserOps): FormulaFn {
  if (isOp(ops.peek(), ")")) throw new Error(`${fname}() needs a seed so the column is the same every time it recalculates, e.g. ${fname}(1)`);
  // The seed is a number written in the formula: a seed read from a column or
  // row() would be a different stream on every row — not reproducible in any
  // useful sense, and O(rows²) to draw.
  const t = ops.eat();
  if (t?.t !== "num" || !(isOp(ops.peek(), ")") || isOp(ops.peek(), ",")))
    throw new Error(`${fname}() takes a seed written as a number, e.g. ${fname}(1) — not a column or an expression`);
  if (isOp(ops.peek(), ",")) throw new Error(`${fname}() takes one argument, the seed — scale it yourself, e.g. ${kind === "uniform" ? "10 * rnd(1)" : "5 + 2 * normal(1)"}`);
  ops.expectOp(")");
  const seed = t.v;
  const why = seedProblem(seed);
  if (why) throw new Error(`${fname}(): ${why}`);
  // One generator, drawn forward as far as the highest row asked for.
  const gen = new Mt19937(seed);
  const values: number[] = [];
  return (_c, ex) => {
    if (!ex) throw new Error(`${fname}() has no row context to evaluate against`);
    while (values.length <= ex.row) values.push(kind === "uniform" ? gen.random() : gen.normal());
    return values[ex.row];
  };
}

/** `interp(v, X, Y)`: column Y looked up at v along column X. */
function parseInterp(ops: ParserOps): FormulaFn {
  ops.nonLocal("aggregate"); // reads the whole of X and Y
  const at = ops.parseExpr();
  ops.expectOp(",");
  const xCol = columnArg("interp", "the X column", ops);
  ops.expectOp(",");
  const yCol = columnArg("interp", "the Y column", ops);
  ops.expectOp(")");
  // One table (or its refusal) per pair of column arrays: every row of one
  // evaluation passes the same arrays, and an unsorted X must cost one scan,
  // not one per row.
  const memo = new WeakMap<readonly number[], WeakMap<readonly number[], InterpTable | { error: string }>>();
  return (c, ex) => {
    if (!ex) throw new Error("interp() has no row context to evaluate against");
    const xs = ex.columns[xCol];
    const ys = ex.columns[yCol];
    if (!xs) throw new Error(`unknown variable "${xCol}"`);
    if (!ys) throw new Error(`unknown variable "${yCol}"`);
    let byY = memo.get(xs);
    if (!byY) memo.set(xs, (byY = new WeakMap()));
    let table = byY.get(ys);
    if (!table) {
      try {
        table = interpTable(xs, ys, xCol);
      } catch (e) {
        table = { error: e instanceof Error ? e.message : String(e) };
      }
      byY.set(ys, table);
    }
    if ("error" in table) throw new Error(table.error);
    return interpAt(table, at(c, ex));
  };
}

/** `fname(` (name and paren already eaten) as one of these forms, or undefined. */
export function tryParseSpecialCall(fname: string, ops: ParserOps): FormulaFn | undefined {
  if (fname === "rnd") return parseRandom("uniform", fname, ops);
  if (fname === "normal") return parseRandom("normal", fname, ops);
  if (fname === "interp") return parseInterp(ops);
  return undefined;
}
