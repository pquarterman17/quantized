// Wave-2 special functions of the worksheet formula language (plan item 33),
// pure numerics for the LAZY formula chunk, mirrored headless by
// calc/column_formula_extra.py (scipy.special) and pinned to it by one
// fixture (`__fixtures__/formulaWave2.json`):
//
//   erfinv(y)  erfcinv(r)   inverse error functions. erfinv(±1) = ±inf,
//                           outside [-1, 1] NaN; erfcinv(0) = inf, (2) = -inf,
//                           outside [0, 2] NaN. Halley-refined from the normal
//                           quantile; relative error about 1e-15 (erfinv uses
//                           the erfc form past |y| = 0.5, so y near 1 keeps its
//                           digits).
//   beta(a, b)  lbeta(a, b) B(a, b) and ln B(a, b), POSITIVE arguments only
//                           (NaN otherwise: scipy continues to negative
//                           non-integers, this does not).
//   digamma(x)              psi(x) = Gamma'/Gamma: -inf at 0, NaN at a negative
//                           integer.
//   besselj(n, x)           Bessel functions of INTEGER order n (|n| <= 500,
//   bessely(n, x)           else NaN) and real x; Y needs x > 0 (-inf at 0, NaN
//                           below). Absolute error about 1e-15, so near a zero
//                           the RELATIVE error is larger, as for any double J.
//
// Bessel method, chosen for accuracy and for having no coefficient tables to
// mistype: J_0..J_n by Miller's backward recurrence normalised with
// 1 = J_0 + 2 sum J_2k (stable, one O(x + n) pass); Y_0 and Y_1 from Neumann's
// series over those J_k (no cancellation) and Y_n by the stable upward
// recurrence. Past x = 25 for Y (and 5000 for J) Hankel's asymptotic series
// takes over, summed to its smallest term.

import { erf, erfc, lgamma, sinpi } from "./formulaMath";
import { normInv } from "./formulaDistNumerics";

const SQRT_PI = Math.sqrt(Math.PI);
const EULER = 0.5772156649015329;

// ── inverse error functions ─────────────────────────────────────────────

/** Halley iterations on f(x) = 0 from x0, for f = erf(x) - y or f = r - erfc(x) (negated
 *  erfc(x) = r): both have f' = 2/sqrt(pi) e^(-x^2) and f''/f' = -2x, so one step serves both. */
function refine(f: (x: number) => number, x0: number): number {
  let x = x0;
  for (let i = 0; i < 4 && x !== 0; i++) {
    const dx = (f(x) * SQRT_PI * Math.exp(x * x)) / 2; // f / f'
    const next = x - dx / (1 + x * dx);
    if (!Number.isFinite(next)) break;
    x = next;
    if (Math.abs(dx) < 1e-16 * Math.abs(x)) break;
  }
  return x;
}

export function erfcinv(r: number): number {
  if (!(r >= 0 && r <= 2)) return NaN;
  if (r === 0) return Infinity;
  if (r === 2) return -Infinity;
  if (r === 1) return 0;
  if (r > 1) return -erfcinv(2 - r); // 2 - r is exact for r in [1, 2]
  return refine((x) => r - erfc(x), -normInv(r / 2) / Math.SQRT2); // g = erfc - r, g' < 0
}

export function erfinv(y: number): number {
  if (!(y >= -1 && y <= 1)) return NaN;
  if (y === 1) return Infinity;
  if (y === -1) return -Infinity;
  const a = Math.abs(y);
  if (a > 0.5) return Math.sign(y) * erfcinv(1 - a); // 1 - a is exact for a >= 0.5
  // Direct Halley on erf(x) = y (no 1 - erfc cancellation for small y), seeded
  // from the series x = (sqrt(pi)/2)(y + (pi/12) y^3).
  return refine((x) => erf(x) - y, (SQRT_PI / 2) * (y + (Math.PI / 12) * y ** 3));
}

// ── beta, digamma ───────────────────────────────────────────────────────

export const lbeta = (a: number, b: number): number => (a > 0 && b > 0 ? lgamma(a) + lgamma(b) - lgamma(a + b) : NaN);
export const beta = (a: number, b: number): number => Math.exp(lbeta(a, b));

export function digamma(x: number): number {
  if (Number.isNaN(x) || x === Infinity) return x;
  if (x === -Infinity) return NaN;
  if (x === 0) return -Infinity;
  if (x < 0 && Number.isInteger(x)) return NaN;
  // Reflection: psi(x) = psi(1 - x) - pi / tan(pi x), with cos(pi x) = sinpi(x + 1/2).
  if (x < 0.5) return digamma(1 - x) - (Math.PI * sinpi(x + 0.5)) / sinpi(x);
  let s = 0;
  let z = x;
  while (z < 10) {
    s -= 1 / z;
    z += 1;
  }
  // ln z - 1/(2z) - sum B_2k / (2k z^2k), through B_14
  const i2 = 1 / (z * z);
  const series = i2 * (1 / 12 - i2 * (1 / 120 - i2 * (1 / 252 - i2 * (1 / 240 - i2 * (1 / 132 - i2 * (691 / 32760 - i2 / 12))))));
  return s + Math.log(z) - 0.5 / z - series;
}

// ── Bessel J and Y of integer order ─────────────────────────────────────

const MAX_ORDER = 500;
const HANKEL_J = 5000;
const HANKEL_Y = 25;

/** J_0 .. J_kmax at x > 0. */
function jUpTo(kmax: number, x: number): number[] {
  if (x < 1e-4) {
    // Two series terms are exact to double precision here (and the recurrence
    // would overflow at x near the smallest doubles).
    const out: number[] = [];
    let lead = 1; // (x/2)^k / k!
    for (let k = 0; k <= kmax; k++) {
      out.push(lead * (1 - (x * x) / (4 * (k + 1))));
      lead *= x / 2 / (k + 1);
    }
    return out;
  }
  const top = Math.max(kmax, x);
  const M = 2 * Math.ceil((top + 30 + 2 * Math.sqrt(top)) / 2);
  const j = new Array<number>(M + 2).fill(0);
  j[M] = 1e-30;
  for (let k = M; k >= 1; k--) {
    j[k - 1] = ((2 * k) / x) * j[k] - j[k + 1];
    if (Math.abs(j[k - 1]) > 1e250) for (let i = k - 1; i <= M; i++) j[i] *= 1e-250;
  }
  let norm = j[0];
  for (let k = 2; k <= M; k += 2) norm += 2 * j[k];
  return j.slice(0, kmax + 1).map((v) => v / norm);
}

/** P, Q of Hankel's expansion (order n, x > 0), summed to the smallest term. */
function hankelPQ(n: number, x: number): [number, number] {
  const mu = 4 * n * n;
  let term = 1;
  let p = 1;
  let q = 0;
  let last = Infinity;
  for (let k = 1; k < 400; k++) {
    term *= (mu - (2 * k - 1) ** 2) / (k * 8 * x);
    if (Math.abs(term) > last) break; // the series has started to diverge
    last = Math.abs(term);
    const sign = Math.floor(k / 2) % 2 === 0 ? 1 : -1;
    if (k % 2 === 1) q += sign * term;
    else p += sign * term;
    if (last < 1e-17) break;
  }
  return [p, q];
}

function hankel(n: number, x: number): { j: number; y: number } {
  const [p, q] = hankelPQ(n, x);
  const chi = x - (n / 2 + 0.25) * Math.PI;
  const amp = Math.sqrt(2 / (Math.PI * x));
  return { j: amp * (p * Math.cos(chi) - q * Math.sin(chi)), y: amp * (p * Math.sin(chi) + q * Math.cos(chi)) };
}

const wholeOrder = (n: number): boolean => Number.isInteger(n) && Math.abs(n) <= MAX_ORDER;
/** Hankel's series converges from its first term when 4 n^2 < 8 x. */
const hankelOk = (m: number, x: number): boolean => 4 * m * m < 8 * x;

export function besselj(n: number, x: number): number {
  if (!wholeOrder(n) || Number.isNaN(x)) return NaN;
  const m = Math.abs(n);
  const a = Math.abs(x);
  if (a === Infinity) return 0;
  if (a === 0) return m === 0 ? 1 : 0;
  const v = a > HANKEL_J && hankelOk(m, a) ? hankel(m, a).j : jUpTo(m, a)[m];
  // J_(-n) = (-1)^n J_n and J_n(-x) = (-1)^n J_n(x)
  return (n < 0 || x < 0) && m % 2 === 1 ? (n < 0 && x < 0 ? v : -v) : v;
}

/** Y_0 and Y_1 at 0 < x < HANKEL_Y by Neumann's series over J_k. */
function y01(x: number): [number, number] {
  const kmax = Math.ceil(x) + 45;
  const J = jUpTo(kmax + 1, x);
  const ln = Math.log(x / 2) + EULER;
  let s0 = 0;
  let s1 = 0;
  for (let k = 1; 2 * k + 1 <= kmax + 1; k++) {
    const sg = k % 2 === 0 ? 1 : -1;
    s0 += (sg * J[2 * k]) / k;
    s1 += (sg * (J[2 * k - 1] - J[2 * k + 1])) / (2 * k);
  }
  return [(2 / Math.PI) * ln * J[0] - (4 / Math.PI) * s0, (-2 / (Math.PI * x)) * J[0] + (2 / Math.PI) * ln * J[1] + (4 / Math.PI) * s1];
}

export function bessely(n: number, x: number): number {
  if (!wholeOrder(n) || Number.isNaN(x) || x < 0) return NaN;
  const m = Math.abs(n);
  if (x === 0) return n < 0 && m % 2 === 1 ? Infinity : -Infinity; // Y_(-1)(0) = +inf
  if (x === Infinity) return 0;
  const sign = n < 0 && m % 2 === 1 ? -1 : 1; // Y_(-n) = (-1)^n Y_n
  if (x >= HANKEL_Y && hankelOk(m, x)) return sign * hankel(m, x).y;
  const [y0, y1] = x >= HANKEL_Y ? [hankel(0, x).y, hankel(1, x).y] : y01(x);
  if (m === 0) return y0;
  let prev = y0;
  let cur = y1;
  for (let k = 1; k < m; k++) [prev, cur] = [cur, ((2 * k) / x) * cur - prev];
  return sign * cur;
}
