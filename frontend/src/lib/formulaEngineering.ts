// Wave-2 element-wise functions of the worksheet formula language (plan item
// 33): engineering helpers and NaN/data-manipulation helpers, all ROW-LOCAL
// (a cell edit only changes its own row). Part of the LAZY formula chunk
// (`WAVE2_FUNCS`, lib/formulaWave2.ts) and mirrored headless by
// calc/column_formula_extra.py, with one shared fixture
// (`__fixtures__/formulaWave2.json`).
//
// Arity, as the other element-wise tables: a missing argument gives a blank
// (NaN) cell and extra arguments are ignored.
//
//   sinc(x)               numpy.sinc: sin(pi x)/(pi x), 1 at 0
//   clamp(v, lo, hi)      v held to [lo, hi]; NaN when lo > hi
//   heaviside(v, h0)      numpy.heaviside: 0 below 0, h0 at 0 (default 0.5), 1 above
//   todb(v)  fromdb(d)    20 log10(v) (amplitude dB) and 10^(d/20)
//   degrees(r)  radians(d)
//   mod(a, b)             the sign of b, as Excel MOD / numpy.mod; b = 0 is NaN
//   trunc(v)              toward zero
//   fact(n)  combin(n, k)  permut(n, k)   whole numbers only (else NaN); 0 <= k <= n
//   gcd(a, b)  lcm(a, b)  whole numbers >= 0 (else NaN)
//   isnan(v)              1 when the cell is blank, else 0 (never blank itself)
//   ifnan(v, alt)         v, or alt where v is blank
//   between(v, lo, hi)    1 when lo <= v <= hi else 0 (NaN if any is blank)
//   wrap(v, lo, hi)       v folded into [lo, hi) — angle wrapping; NaN if hi <= lo
//   choose(k, a, b, …)    the k-th value (1-based, k truncated); NaN out of range
//   cbrt  expm1  log1p    the numpy functions

import { gamma, lgamma, sinpi } from "./formulaMath";

type Fn = (...a: number[]) => number;

/** `f` with the table's arity rule: fewer than `n` arguments is NaN. */
const arity =
  (n: number, f: Fn): Fn =>
  (...a) =>
    a.length < n ? NaN : f(...a.slice(0, n));

const isWhole = (v: number): boolean => Number.isInteger(v);
const nonNegWhole = (v: number): boolean => isWhole(v) && v >= 0;

function mod(a: number, b: number): number {
  if (b === 0) return NaN;
  const r = a % b;
  return r !== 0 && r < 0 !== b < 0 ? r + b : r;
}

const LOOP_MAX = 2000;

function permut(n: number, k: number): number {
  if (!nonNegWhole(n) || !nonNegWhole(k) || k > n) return NaN;
  if (k > LOOP_MAX) return Math.exp(lgamma(n + 1) - lgamma(n - k + 1));
  let p = 1;
  for (let i = 0; i < k; i++) p *= n - i;
  return p;
}

function combin(n: number, k: number): number {
  if (!nonNegWhole(n) || !nonNegWhole(k) || k > n) return NaN;
  const m = Math.min(k, n - k);
  if (m > LOOP_MAX) return Math.exp(lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1));
  let c = 1;
  for (let i = 1; i <= m; i++) c = (c * (n - m + i)) / i;
  return c;
}

function gcd(a: number, b: number): number {
  if (!nonNegWhole(a) || !nonNegWhole(b)) return NaN;
  while (b) [a, b] = [b, a % b];
  return a;
}

export const ENGINEERING_FUNCS: Record<string, Fn> = {
  sinc: arity(1, (x) => (x === 0 ? 1 : sinpi(x) / (Math.PI * x))),
  clamp: arity(3, (v, lo, hi) => (lo > hi ? NaN : Math.min(Math.max(v, lo), hi))),
  heaviside: (...a) => (a.length < 1 ? NaN : a[0] < 0 ? 0 : a[0] > 0 ? 1 : a[0] === 0 ? (a.length > 1 ? a[1] : 0.5) : NaN),
  todb: arity(1, (v) => 20 * Math.log10(v)),
  fromdb: arity(1, (d) => 10 ** (d / 20)),
  degrees: arity(1, (r) => r * (180 / Math.PI)),
  radians: arity(1, (d) => d * (Math.PI / 180)),
  mod: arity(2, mod),
  trunc: arity(1, Math.trunc),
  fact: arity(1, (n) => (nonNegWhole(n) ? gamma(n + 1) : NaN)),
  combin: arity(2, combin),
  permut: arity(2, permut),
  gcd: arity(2, gcd),
  lcm: arity(2, (a, b) => (!nonNegWhole(a) || !nonNegWhole(b) ? NaN : a === 0 || b === 0 ? 0 : (a / gcd(a, b)) * b)),
  isnan: arity(1, (v) => (Number.isNaN(v) ? 1 : 0)),
  ifnan: arity(2, (v, alt) => (Number.isNaN(v) ? alt : v)),
  between: arity(3, (v, lo, hi) => (Number.isNaN(v + lo + hi) ? NaN : lo <= v && v <= hi ? 1 : 0)),
  wrap: arity(3, (v, lo, hi) => (hi > lo ? lo + mod(v - lo, hi - lo) : NaN)),
  choose: (...a) => {
    if (a.length < 2 || Number.isNaN(a[0])) return NaN;
    const k = Math.trunc(a[0]);
    return k >= 1 && k < a.length ? a[k] : NaN;
  },
  cbrt: arity(1, Math.cbrt),
  expm1: arity(1, Math.expm1),
  log1p: arity(1, Math.log1p),
};
