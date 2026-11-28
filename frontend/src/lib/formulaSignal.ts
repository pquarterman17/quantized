// Whole-column signal functions of the worksheet formula language, the app
// twin of calc/column_formula_signal.py (which the exported script runs).
// Part of the LAZY formula chunk: lib/formulaRefs.ts appends `tryParseSignalCall`
// to its `tryParseCall` chain. The names are in lib/formulaStatNames.ts.
//
//   movmax(A, back, fwd)  movmin   window r-back .. r+fwd, TRUNCATED at the ends; a blank
//                                  cell in the window is skipped; a blank row stays blank
//                                  (the rule of movavg, lib/formulaStats.ts)
//   cummax(A)  cummin  cumprod     running value down to each row; a blank cell stays blank
//                                  and leaves the running value alone (as cumsum)
//   savgol(A, window, order)       Savitzky-Golay smoothing of a column with no blanks, rows
//                                  equally spaced; the ends repeat the first / last value
//                                  (Origin's "Repeat" boundary; scipy mode="nearest")
//
// The first argument is a bare column (not an expression, not rng() or A[i:j]: a
// whole-column function has no row range to cut), the rest are plain unsigned
// numbers, checked when the formula is ENTERED. So the exported script, which
// reads the same shape, never computes a different column than the app did.

import type { ParserOps } from "./formulaRowFns";
import { SIGNAL_NAMES } from "./formulaStatNames";
import { movingWindow } from "./formulaStats";
import type { FormulaFn, Tok } from "./formulaTypes";

const finite = (v: number): boolean => Number.isFinite(v);
const isOp = (t: Tok | undefined, v: string): boolean => !!t && t.t === "op" && t.v === v;
const ARITY: Record<string, number> = { movmax: 2, movmin: 2, savgol: 2, cummax: 0, cummin: 0, cumprod: 0 };

function whole(fname: string, what: string, v: number, min = 0): number {
  if (!Number.isInteger(v) || v < min) throw new Error(`${fname}(): ${what} must be a whole number, ${min} or more`);
  return v;
}

/** The running statistic down the column; a blank cell stays blank and does not reset the run. */
export function running(kind: "cummax" | "cummin" | "cumprod", y: readonly number[]): number[] {
  let state = kind === "cumprod" ? 1 : NaN;
  return y.map((v) => {
    if (!finite(v)) return NaN;
    if (kind === "cumprod") state *= v;
    else state = Number.isNaN(state) ? v : kind === "cummax" ? Math.max(state, v) : Math.min(state, v);
    return state;
  });
}

/** Weights of the centred least-squares polynomial fit (value at the middle row), in scaled offsets t = k / m. */
export function savgolWeights(window: number, order: number): number[] {
  const m = (window - 1) / 2;
  const n = order + 1;
  // Normal equations (V'V) a = e0 for V[k][j] = (k/m)^j, k = -m..m; the weight of row k is V[k] . a.
  const a: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => {
    let s = 0;
    for (let k = -m; k <= m; k++) s += (k / m) ** (i + j);
    return s;
  }).concat([i === 0 ? 1 : 0]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let j = c; j <= n; j++) a[r][j] -= f * a[c][j];
    }
  }
  const coef = a.map((row, i) => row[n] / row[i]);
  const out: number[] = [];
  for (let k = -m; k <= m; k++) out.push(coef.reduce((s, c, j) => s + c * (k / m) ** j, 0));
  return out;
}

/** Savitzky-Golay smoothing, ends padded by repeating the first / last value. */
export function savgol(y: readonly number[], window: number, order: number): number[] {
  const w = savgolWeights(window, order);
  const m = (window - 1) / 2;
  const at = (i: number): number => y[Math.min(y.length - 1, Math.max(0, i))];
  return y.map((_, r) => w.reduce((s, wk, j) => s + wk * at(r + j - m), 0));
}

function checkSavgol(window: number, order: number, y: readonly number[]): void {
  whole("savgol", "window", window, 3);
  whole("savgol", "order", order);
  if (window % 2 === 0) throw new Error("savgol(): window must be odd");
  if (order >= window) throw new Error("savgol(): order must be smaller than window");
  if (window > y.length) throw new Error(`savgol(): window (${window}) is larger than the column (${y.length} rows)`);
  if (!y.every(finite)) throw new Error("savgol(): the column has blank cells; fill or remove them first");
}

/** `fname(` (name and paren eaten) as one of this family, or undefined. */
export function tryParseSignalCall(fname: string, ops: ParserOps, consts: Record<string, number>): FormulaFn | undefined {
  if (!SIGNAL_NAMES.has(fname)) return undefined;
  ops.nonLocal("aggregate"); // reads other rows: never incremental
  const t = ops.peek();
  if (t?.t !== "name" || t.v in consts || !(isOp(ops.peekAt(1), ",") || isOp(ops.peekAt(1), ")"))) throw new Error(`${fname}() expects a bare column name, e.g. ${fname}(A, …)`);
  ops.eat();
  ops.ref(t.v);
  const nums: number[] = [];
  for (let i = 0; i < ARITY[fname]; i++) {
    if (!isOp(ops.peek(), ",")) throw new Error(`${fname}() takes the column and ${ARITY[fname]} plain numbers`);
    ops.eat();
    const n = ops.eat();
    if (n.t !== "num") throw new Error(`${fname}() takes the column and ${ARITY[fname]} plain numbers`);
    nums.push(n.v);
  }
  if (!isOp(ops.peek(), ")")) throw new Error(ARITY[fname] ? `${fname}() takes the column and ${ARITY[fname]} plain numbers` : `${fname}() takes just a column`);
  ops.expectOp(")");
  const col = t.v;
  const memo = new WeakMap<readonly number[], number[]>();
  const compute = (y: readonly number[]): number[] => {
    if (fname === "savgol") {
      checkSavgol(nums[0], nums[1], y);
      return savgol(y, nums[0], nums[1]);
    }
    if (fname === "movmax" || fname === "movmin") return movingWindow(fname === "movmax" ? "max" : "min", y, whole(fname, "back", nums[0]), whole(fname, "forward", nums[1]));
    return running(fname as "cummax" | "cummin" | "cumprod", y);
  };
  return (_c, ex) => {
    if (!ex) throw new Error(`${fname}() has no row context to evaluate against`);
    const y = ex.columns[col];
    if (!y) throw new Error(`unknown variable "${col}"`);
    let out = memo.get(y);
    if (!out) memo.set(y, (out = compute(y)));
    return out[ex.row] ?? NaN;
  };
}
