// Parsing and evaluation of the moving-window, column-statistic and
// conditional-aggregate calls (plan item 28, aggregate half). Part of the LAZY
// formula chunk: lib/formulaRefs.ts appends `tryParseStatCall` to its
// `tryParseCall` chain. The arithmetic is in lib/formulaStats.ts, the
// condition grammar in lib/formulaCondition.ts.
//
//   movavg(A, back, fwd)  movmedian  movrms  movsum  movsd  movslope
//       statistic over rows r-back .. r+fwd (truncated at the ends; see
//       formulaStats.ts). movslope is the slope of A against x.
//   emovavg(A, n)         exponential average, alpha = 2 / (n + 1)
//   correl(A, B)  cov(A, B)  slope(X, Y)  intercept(X, Y)
//       slope/intercept take X FIRST, like Origin's Slope(vx, vy)
//   percentile(A, p)      p in 0..100, linear interpolation
//   skew  kurt  geomean  harmean  mad  mode   (A)
//   sumif(range, cond [, sumrange])  averageif(...)  countif(range, cond)
//   maxifs(maxrange, range, cond [, range, cond ...])  minifs(...)
//       cond is text such as ">5" or "<>0" (formulaCondition.ts), or a number
//       (equality). A range is a column letter, a categorical column, or
//       col("Name") for a text column.
//
// ROW SCOPE, as mean(A): these read ex.columns, the same rows the plain
// per-row context sees (see lib/formula.ts: the dataset's full row set, not
// the exclusion/filter-pruned analysis view). Each reports itself non-local,
// so a one-cell edit recomputes the whole column (formulaIncremental.ts), and
// the headless exporter refuses them (they are not in the plain FUNCS table).

import { equalsNumber, matches, parseCondition, type Condition, type CondSource } from "./formulaCondition";
import { COND_NAMES, COLUMN_NAMES, PAIR_NAMES, WINDOW_NAMES } from "./formulaStatNames";
import { columnStat, exponentialAverage, movingSlope, movingWindow, pairStat, percentileOf, type ColumnStat, type PairStat, type WindowKind } from "./formulaStats";
import type { ParserOps } from "./formulaRowFns";
import type { FormulaFn, FormulaRowContext, Tok } from "./formulaTypes";

const isOp = (t: Tok | undefined, v: string): boolean => !!t && t.t === "op" && t.v === v;

const WINDOW_KIND: Record<string, WindowKind> = { movavg: "avg", movmedian: "median", movrms: "rms", movsum: "sum", movsd: "sd" };

type ColRef = { col: string } | { text: string };

function bareCol(fname: string, ops: ParserOps, consts: Record<string, number>, what: string): string {
  const t = ops.peek();
  const next = ops.peekAt(1);
  if (t?.t !== "name" || t.v in consts || !(isOp(next, ",") || isOp(next, ")"))) throw new Error(`${fname}() expects ${what} as a bare column name, e.g. ${fname}(A, …)`);
  ops.eat();
  ops.ref(t.v);
  return t.v;
}

/** A range argument: a bare column, or `col("Name")` for a text column. */
function rangeRef(fname: string, ops: ParserOps, consts: Record<string, number>, what: string): ColRef {
  const t = ops.peek();
  if (t?.t === "name" && t.v === "col" && isOp(ops.peekAt(1), "(") && ops.peekAt(2)?.t === "str" && isOp(ops.peekAt(3), ")")) {
    ops.eat();
    ops.eat();
    const text = (ops.eat() as Extract<Tok, { t: "str" }>).v;
    ops.eat();
    return { text };
  }
  return { col: bareCol(fname, ops, consts, what) };
}

function column(ex: FormulaRowContext | undefined, fname: string, name: string): number[] {
  if (!ex) throw new Error(`${fname}() has no row context to evaluate against`);
  const arr = ex.columns[name];
  if (!arr) throw new Error(`unknown variable "${name}"`);
  return arr;
}

/** One cached result per (column array, key): every row of a recompute passes
 *  the same arrays, so the whole column is computed once, not once per row. */
function memoized<T>(): (arr: readonly number[], key: string, make: () => T) => T {
  const memo = new WeakMap<readonly number[], Map<string, T>>();
  return (arr, key, make) => {
    let m = memo.get(arr);
    if (!m) memo.set(arr, (m = new Map()));
    if (!m.has(key)) m.set(key, make());
    return m.get(key) as T;
  };
}

function wholeNumber(fname: string, what: string, v: number): number {
  if (!Number.isInteger(v) || v < 0) throw new Error(`${fname}(): ${what} must be a whole number of rows, 0 or more`);
  return v;
}

function parseWindow(fname: string, ops: ParserOps, consts: Record<string, number>): FormulaFn {
  const col = bareCol(fname, ops, consts, "the column");
  ops.expectOp(",");
  const back = ops.parseExpr();
  ops.expectOp(",");
  const fwd = ops.parseExpr();
  ops.expectOp(")");
  const memo = memoized<{ x?: readonly number[]; out: number[] }>();
  return (c, ex) => {
    const y = column(ex, fname, col);
    const [b, f] = [back(c, ex), fwd(c, ex)];
    if (Number.isNaN(b) || Number.isNaN(f)) return NaN;
    const [nb, nf] = [wholeNumber(fname, "back", b), wholeNumber(fname, "forward", f)];
    const x = fname === "movslope" ? column(ex, fname, "x") : undefined;
    let hit = memo(y, `${nb}:${nf}`, () => ({ x, out: x ? movingSlope(x, y, nb, nf) : movingWindow(WINDOW_KIND[fname], y, nb, nf) }));
    if (hit.x !== x) hit = { x, out: movingSlope(x as number[], y, nb, nf) }; // a different x under the same y: recompute
    return hit.out[ex!.row] ?? NaN;
  };
}

function parseEmovavg(fname: string, ops: ParserOps, consts: Record<string, number>): FormulaFn {
  const col = bareCol(fname, ops, consts, "the column");
  ops.expectOp(",");
  const n = ops.parseExpr();
  ops.expectOp(")");
  const memo = memoized<number[]>();
  return (c, ex) => {
    const y = column(ex, fname, col);
    const len = n(c, ex);
    if (Number.isNaN(len)) return NaN;
    if (!Number.isInteger(len) || len < 1) throw new Error("emovavg(): n must be a whole number, 1 or more");
    return memo(y, String(len), () => exponentialAverage(y, len))[ex!.row] ?? NaN;
  };
}

function parsePair(fname: string, ops: ParserOps, consts: Record<string, number>): FormulaFn {
  const a = bareCol(fname, ops, consts, "the first column");
  ops.expectOp(",");
  const b = bareCol(fname, ops, consts, "the second column");
  ops.expectOp(")");
  const memo = memoized<{ other: readonly number[]; v: number }>();
  return (_c, ex) => {
    const [ya, yb] = [column(ex, fname, a), column(ex, fname, b)];
    let hit = memo(ya, "", () => ({ other: yb, v: pairStat(fname as PairStat, ya, yb) }));
    if (hit.other !== yb) hit = { other: yb, v: pairStat(fname as PairStat, ya, yb) };
    return hit.v;
  };
}

function parseColumnStat(fname: string, ops: ParserOps, consts: Record<string, number>): FormulaFn {
  const col = bareCol(fname, ops, consts, "the column");
  ops.expectOp(")");
  const memo = memoized<number>();
  return (_c, ex) => {
    const y = column(ex, fname, col);
    return memo(y, "", () => columnStat(fname as ColumnStat, y));
  };
}

function parsePercentile(fname: string, ops: ParserOps, consts: Record<string, number>): FormulaFn {
  const col = bareCol(fname, ops, consts, "the column");
  ops.expectOp(",");
  const p = ops.parseExpr();
  ops.expectOp(")");
  const memo = memoized<number>();
  return (c, ex) => {
    const y = column(ex, fname, col);
    const pv = p(c, ex);
    return memo(y, String(pv), () => percentileOf(y, pv));
  };
}

// ── conditional aggregates ──────────────────────────────────────────────

/** A condition argument: a quoted string (parsed NOW, so a bad one is a
 *  formula error at entry) or a numeric expression meaning "equals". */
function parseCondArg(fname: string, ops: ParserOps): (c: Record<string, number>, ex: FormulaRowContext | undefined) => Condition | null {
  const t = ops.peek();
  if (t?.t === "str" && (isOp(ops.peekAt(1), ",") || isOp(ops.peekAt(1), ")"))) {
    ops.eat();
    const cond = parseCondition(t.v);
    return () => cond;
  }
  if (t?.t === "str") throw new Error(`${fname}(): a condition is quoted text such as ">5", or a number`);
  const value = ops.parseExpr();
  return (c, ex) => {
    const v = value(c, ex);
    return Number.isNaN(v) ? null : equalsNumber(v);
  };
}

function source(fname: string, ref: ColRef, ex: FormulaRowContext | undefined): { src: CondSource; key: readonly number[] } {
  if ("text" in ref) {
    const cells = ex?.text?.[ref.text];
    if (!cells) throw new Error(`no column named "${ref.text}"`);
    return { src: { kind: "text", label: `col("${ref.text}")`, cells }, key: cells as unknown as readonly number[] };
  }
  const values = column(ex, fname, ref.col);
  const levels = ex?.levels?.[ref.col];
  return { src: levels ? { kind: "levels", label: ref.col, values, levels } : { kind: "number", label: ref.col, values }, key: values };
}

function parseConditional(fname: string, ops: ParserOps, consts: Record<string, number>): FormulaFn {
  const isIfs = fname === "maxifs" || fname === "minifs";
  const target = isIfs ? bareCol(fname, ops, consts, "the column to take the maximum of") : undefined;
  if (isIfs) ops.expectOp(",");
  const tests: { range: ColRef; cond: ReturnType<typeof parseCondArg> }[] = [];
  let sumCol: string | undefined;
  const readTest = (): void => {
    const range = rangeRef(fname, ops, consts, "the range");
    ops.expectOp(",");
    tests.push({ range, cond: parseCondArg(fname, ops) });
  };
  readTest();
  if (isIfs) {
    while (isOp(ops.peek(), ",")) {
      ops.eat();
      readTest();
    }
  } else if (fname !== "countif" && isOp(ops.peek(), ",")) {
    ops.eat();
    sumCol = bareCol(fname, ops, consts, "the sum range");
  }
  ops.expectOp(")");
  const memo = memoized<number>();
  return (c, ex) => {
    const srcs = tests.map((t) => source(fname, t.range, ex));
    const conds = tests.map((t) => t.cond(c, ex));
    if (conds.some((k) => k === null)) return NaN; // a blank condition cell
    const key = conds.map((k) => `${(k as Condition).op}${(k as Condition).operand}`).join("\u0001");
    return memo(srcs[0].key, key, () => {
      const n = srcs[0].src.kind === "text" ? srcs[0].src.cells.length : srcs[0].src.values.length;
      const picked: number[] = [];
      const valueCol = isIfs ? column(ex, fname, target as string) : sumCol ? column(ex, fname, sumCol) : undefined;
      let count = 0;
      for (let r = 0; r < n; r++) {
        if (!srcs.every((s, i) => matches(conds[i] as Condition, s.src, r))) continue;
        count++;
        const v = valueCol ? valueCol[r] : srcs[0].src.kind === "number" ? srcs[0].src.values[r] : NaN;
        if (Number.isFinite(v)) picked.push(v);
      }
      switch (fname) {
        case "countif":
          return count;
        case "sumif":
          return picked.reduce((s, v) => s + v, 0);
        case "averageif":
          return picked.length ? picked.reduce((s, v) => s + v, 0) / picked.length : NaN;
        case "maxifs":
          return picked.length ? picked.reduce((m, v) => Math.max(m, v), -Infinity) : NaN;
        default:
          return picked.length ? picked.reduce((m, v) => Math.min(m, v), Infinity) : NaN;
      }
    });
  };
}

/** `fname(` (name and paren eaten) as one of this family, or undefined. */
export function tryParseStatCall(fname: string, ops: ParserOps, consts: Record<string, number>): FormulaFn | undefined {
  const kind = WINDOW_NAMES.includes(fname) ? "window" : PAIR_NAMES.includes(fname) ? "pair" : COLUMN_NAMES.includes(fname) ? "column" : COND_NAMES.includes(fname) ? "cond" : fname === "emovavg" ? "ema" : fname === "percentile" ? "pct" : null;
  if (!kind) return undefined;
  ops.nonLocal("aggregate"); // reads other rows / the whole column: never incremental
  switch (kind) {
    case "window":
      return parseWindow(fname, ops, consts);
    case "ema":
      return parseEmovavg(fname, ops, consts);
    case "pair":
      return parsePair(fname, ops, consts);
    case "column":
      return parseColumnStat(fname, ops, consts);
    case "pct":
      return parsePercentile(fname, ops, consts);
    default:
      return parseConditional(fname, ops, consts);
  }
}
