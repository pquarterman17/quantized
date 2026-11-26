// Numerics behind the distribution functions of the worksheet formula language
// (lib/formulaDist.ts) — pure, no dependency, part of the LAZY formula chunk.
//
//   normCdf / normSf / normInv         Φ by erfc; Φ⁻¹ by Acklam's rational
//                                      approximation (rel. error 1.2e-9,
//                                      https://stackedboxes.org/2017/05/01/acklams-normal-quantile-function/)
//                                      sharpened by one Halley step on Φ
//   gammaPQ(a, x)                      regularized lower/upper incomplete gamma,
//                                      Numerical Recipes 3rd ed. §6.2: series
//                                      for x < a+1, modified-Lentz continued
//                                      fraction beyond
//   betaIQ(a, b, x)                    regularized incomplete beta, NR §6.4:
//                                      Lentz continued fraction, evaluated on the
//                                      side of the symmetry x ↔ 1−x where it
//                                      converges, so the SMALLER tail is always
//                                      the one computed directly
//   invert(pair, pdf, p, …)            safeguarded Newton (bisection fallback) on
//                                      a monotone CDF, in the small-tail form so
//                                      p near 0 and p near 1 are both accurate
//
// Every CDF helper returns the pair [lower, upper] so a tail argument costs
// nothing and a tiny upper tail is not 1 − (almost 1). Accuracy: the CDFs and
// densities agree with scipy.stats to ~1e-13 relative for shape parameters up
// to ~100; the prefactor exp(a·ln x − x − lnΓ(a)) loses about a·ln(a)·1e-16
// relative beyond that. The inverses are solved to 1e-14 relative.

import { erfc, lgamma } from "./formulaMath";

const EPS = 1e-16;
const FPMIN = 1e-300;
const MAXIT = 100000;
const SQRT2 = Math.SQRT2;
const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** [lower, upper] tail probabilities of a CDF at one point. */
export type Pair = readonly [number, number];

// ── normal ──────────────────────────────────────────────────────────────

export const normPair = (z: number): Pair => {
  if (Number.isNaN(z)) return [NaN, NaN];
  return [0.5 * erfc(-z / SQRT2), 0.5 * erfc(z / SQRT2)];
};

export const normPdf = (z: number): number => Math.exp(-0.5 * z * z) / SQRT_2PI;

const ACK_A = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
const ACK_B = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
const ACK_C = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const ACK_D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

/** Φ⁻¹(p) for p in (0, 1); ±Infinity at the ends, NaN outside. */
export function normInv(p: number): number {
  if (!(p >= 0 && p <= 1)) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  if (p > 0.5) return -normInv(1 - p); // 1 − p is exact for p ≥ 0.5
  const [a, b, c, d] = [ACK_A, ACK_B, ACK_C, ACK_D];
  let x: number;
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const e = normPair(x)[0] - p; // lower tail: relatively exact down to the smallest doubles
  const u = (e * SQRT_2PI) / Math.exp(-0.5 * x * x);
  return x - u / (1 + (x * u) / 2); // Halley
}

// ── incomplete gamma ────────────────────────────────────────────────────

/** [P(a, x), Q(a, x)], the regularized incomplete gamma functions. */
export function gammaPQ(a: number, x: number): Pair {
  if (Number.isNaN(a) || Number.isNaN(x) || !(a > 0)) return [NaN, NaN];
  if (x <= 0) return [0, 1];
  if (x === Infinity) return [1, 0];
  const pre = Math.exp(-x + a * Math.log(x) - lgamma(a));
  if (x < a + 1) {
    let ap = a;
    let del = 1 / a;
    let sum = del;
    for (let n = 0; n < MAXIT; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * EPS) break;
    }
    const p = Math.min(sum * pre, 1);
    return [p, 1 - p];
  }
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < MAXIT; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  const q = Math.min(pre * h, 1);
  return [1 - q, q];
}

// ── incomplete beta ─────────────────────────────────────────────────────

function betaCf(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

export const lbeta = (a: number, b: number): number => lgamma(a) + lgamma(b) - lgamma(a + b);

/** [I_x(a, b), 1 − I_x(a, b)], the regularized incomplete beta function. */
export function betaIQ(a: number, b: number, x: number): Pair {
  if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(x) || !(a > 0) || !(b > 0)) return [NaN, NaN];
  if (x <= 0) return [0, 1];
  if (x >= 1) return [1, 0];
  const pre = Math.exp(a * Math.log(x) + b * Math.log1p(-x) - lbeta(a, b));
  if (x < (a + 1) / (a + b + 2)) {
    const i = Math.min((pre * betaCf(a, b, x)) / a, 1);
    return [i, 1 - i];
  }
  const q = Math.min((pre * betaCf(b, a, 1 - x)) / b, 1);
  return [1 - q, q];
}

// ── inversion ───────────────────────────────────────────────────────────

/** x with lower(x) = p for a CDF that is increasing on (lo, hi) — `pair` gives
 *  [lower, upper] at x, `pdf` the density (Newton's slope), `x0` a starting
 *  guess (any point of the support; a good one is faster, a bad one only slower).
 *  Solved in the form with the smaller tail, so p = 1e-300 and 1 − 1e-16 both
 *  keep their relative precision. NaN for p outside [0, 1]. */
export function invert(pair: (x: number) => Pair, pdf: (x: number) => number, p: number, lo: number, hi: number, x0: number): number {
  if (!(p >= 0 && p <= 1)) return NaN;
  if (p === 0) return lo;
  if (p === 1) return hi;
  const q = 1 - p;
  const lowerForm = p <= 0.5;
  // Increasing in x; zero at the root, in the small-tail form.
  const resid = (x: number): number => (lowerForm ? pair(x)[0] - p : q - pair(x)[1]);
  let a = lo;
  let b = hi;
  let x = Math.min(Math.max(x0, Number.isFinite(lo) ? lo : -Infinity), Number.isFinite(hi) ? hi : Infinity);
  if (!Number.isFinite(x)) x = 0;
  // Bracket: a with resid < 0, b with resid ≥ 0 (expanding from x0 by doubling steps).
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    let step = Math.max(Math.abs(x) * 0.5, 1);
    const r0 = resid(x);
    if (r0 >= 0) {
      b = x;
      for (let k = 0; k < 2100; k++) {
        const t = Math.max(b - step, lo);
        if (resid(t) < 0 || t === lo) {
          a = t;
          break;
        }
        b = t;
        step *= 2;
      }
    } else {
      a = x;
      for (let k = 0; k < 2100; k++) {
        const t = Math.min(a + step, hi);
        if (resid(t) >= 0 || t === hi) {
          b = t;
          break;
        }
        a = t;
        step *= 2;
      }
    }
    if (a === lo && lo === 0) a = 0;
  }
  x = Math.min(Math.max(x, a), b);
  for (let it = 0; it < 2000; it++) {
    const r = resid(x);
    if (r === 0) return x;
    if (r < 0) a = x;
    else b = x;
    const slope = pdf(x);
    let nx = x - r / slope;
    if (!(Number.isFinite(nx) && nx > a && nx < b)) {
      nx = a > 0 && b / a > 8 ? Math.sqrt(a * b) : a === 0 && Number.isFinite(b) && lo === 0 ? b / 2 : 0.5 * (a + b);
      if (!Number.isFinite(nx)) nx = x;
    }
    if (Math.abs(nx - x) <= 1e-15 * Math.abs(nx) || b - a <= 1e-15 * Math.abs(nx)) return nx;
    x = nx;
  }
  return x;
}
