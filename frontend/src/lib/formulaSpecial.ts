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
  const seedFn = ops.parseExpr();
  if (isOp(ops.peek(), ",")) throw new Error(`${fname}() takes one argument, the seed — scale it yourself, e.g. ${kind === "uniform" ? "10 * rnd(1)" : "5 + 2 * normal(1)"}`);
  ops.expectOp(")");
  // One generator per seed, drawn forward as far as the highest row asked for.
  const streams = new Map<number, { gen: Mt19937; values: number[] }>();
  return (c, ex) => {
    if (!ex) throw new Error(`${fname}() has no row context to evaluate against`);
    const seed = seedFn(c, ex);
    const why = seedProblem(seed);
    if (why) throw new Error(`${fname}(): ${why}`);
    let s = streams.get(seed);
    if (!s) streams.set(seed, (s = { gen: new Mt19937(seed), values: [] }));
    while (s.values.length <= ex.row) s.values.push(kind === "uniform" ? s.gen.random() : s.gen.normal());
    return s.values[ex.row];
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
  const memo = new WeakMap<readonly number[], WeakMap<readonly number[], InterpTable>>();
  return (c, ex) => {
    if (!ex) throw new Error("interp() has no row context to evaluate against");
    const xs = ex.columns[xCol];
    const ys = ex.columns[yCol];
    if (!xs) throw new Error(`unknown variable "${xCol}"`);
    if (!ys) throw new Error(`unknown variable "${yCol}"`);
    let byY = memo.get(xs);
    if (!byY) memo.set(xs, (byY = new WeakMap()));
    let table = byY.get(ys);
    if (!table) byY.set(ys, (table = interpTable(xs, ys, xCol)));
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
