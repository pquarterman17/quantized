// The worksheet formula language's special functions (gap audit 4, G3) —
// pure numerics, loaded with the LAZY formula chunk (lib/formulaRefs.ts), never
// at first paint. Each one is defined to agree with numpy/scipy, and
// formulaMath.test.ts checks it against values frozen from them:
//
//   erf(v), erfc(v)        scipy.special.erf / erfc
//   gamma(v)               scipy.special.gamma: inf at 0, NaN at a negative
//                          integer, inf past 171.62 (overflow)
//   lgamma(v)              scipy.special.gammaln = log|Γ(v)| (inf at 0 and at
//                          negative integers)
//   round(v, n)            numpy.round: halves go to the EVEN neighbour
//                          (round(2.5) is 2, round(0.125, 2) is 0.12 — the
//                          float 0.125 is exact, so it is a true half). n
//                          defaults to 0 and may be negative (round(1234, -2)).
//   floor(v, n), ceil(v, n) numpy.floor(v * 10**n) / 10**n (and the ceil
//                          twin); n < 0 divides instead, as numpy.round does.
//                          The digits form lives in lib/formulaFuncs.ts
//                          (eager): floor/ceil existed before this chunk did.
//   rnd(seed)              numpy.random.RandomState(seed).random_sample(N)[row]
//   normal(seed)           numpy.random.RandomState(seed).standard_normal(N)[row]
//                          — the same Mersenne Twister and the same polar
//                          method, so the column matches numpy's draw for that
//                          seed to the last bit (the log/sqrt may differ by
//                          one ulp). The seed is REQUIRED, a whole number in
//                          0..2^32-1: an unseeded column would change on every
//                          recalculation.
//   interp(v, X, Y)        numpy.interp(v, X, Y, left=nan, right=nan): the
//                          curve X→Y looked up at v, linear between points,
//                          NaN outside it — never extrapolated, never clamped.
//                          Pairs with a blank X or Y are skipped. X must be
//                          strictly increasing or strictly decreasing, or it
//                          is an error (never a silent answer from an
//                          unsorted table).
//
// A digits argument that is not a whole number is an error, not rounded.

import { atDigits } from "./formulaFuncs";

const SQRT_PI = Math.sqrt(Math.PI);
/** Where erfc switches from 1 − erf to its continued fraction. */
const ERFC_CF = 1.2;

/** erf by the all-positive series 2/√π·e^(−v²)·Σ (2v²)^k·v/(2k+1)!! below
 *  |v| < ERFC_CF (no cancellation), else 1 − erfc. */
export function erf(v: number): number {
  if (Number.isNaN(v)) return NaN;
  const a = Math.abs(v);
  if (a >= ERFC_CF) return Math.sign(v) * (1 - erfcLarge(a));
  const x2 = 2 * a * a;
  let term = a;
  let sum = a;
  for (let k = 1; k < 200 && term > sum * 1e-17; k++) {
    term *= x2 / (2 * k + 1);
    sum += term;
  }
  return Math.sign(v) * ((2 / SQRT_PI) * Math.exp(-a * a) * sum);
}

/** erfc(v) for v ≥ ERFC_CF: the continued fraction, evaluated by modified Lentz. */
function erfcLarge(a: number): number {
  if (a > 27.3) return 0; // below the smallest double
  // erfc(a) = e^(−a²)/√π · 1/(a + (1/2)/(a + 1/(a + (3/2)/(a + …))))
  const tiny = 1e-300;
  let f = a;
  let c = a;
  let d = 0;
  for (let k = 1; k < 5000; k++) {
    const an = k / 2;
    d = a + an * d;
    d = Math.abs(d) < tiny ? tiny : d;
    c = a + an / c;
    c = Math.abs(c) < tiny ? tiny : c;
    d = 1 / d;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-a * a) / SQRT_PI / f;
}

export function erfc(v: number): number {
  if (Number.isNaN(v)) return NaN;
  if (v >= ERFC_CF) return erfcLarge(v);
  if (v <= -ERFC_CF) return 2 - erfcLarge(-v);
  return 1 - erf(v);
}

// Lanczos, g = 7, n = 9 (relative error ≈ 1e-15 over the real line).
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];
const LOG_SQRT_2PI = 0.5 * Math.log(2 * Math.PI);

function lanczosSum(z: number): number {
  let a = LANCZOS[0];
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (z + i);
  return a;
}

/** Γ(v) — exact products for whole v up to 171, as scipy's table is. */
export function gamma(v: number): number {
  if (Number.isNaN(v) || v === -Infinity) return NaN;
  if (v === 0) return Object.is(v, -0) ? -Infinity : Infinity;
  if (Number.isInteger(v)) {
    if (v < 0) return NaN;
    if (v > 171) return Infinity;
    let p = 1;
    for (let k = 2; k < v; k++) p *= k;
    return p;
  }
  if (v < 0.5) return Math.PI / (Math.sin(Math.PI * v) * gamma(1 - v));
  if (v > 171.62) return Infinity;
  // Γ(v) = (v−1)(v−2)…·Γ(f), f in [1, 2): Lanczos is most accurate there, and
  // the product's rounding grows far slower than Lanczos' own error at large v.
  let p = 1;
  let f = v;
  while (f >= 2) p *= --f;
  const z = f - 1;
  const t = z + 7.5;
  return p * (Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * lanczosSum(z));
}

/** log|Γ(v)|, scipy.special.gammaln. */
export function lgamma(v: number): number {
  if (Number.isNaN(v)) return NaN;
  if (!Number.isFinite(v)) return Infinity;
  if (v <= 0 && Number.isInteger(v)) return Infinity;
  if (v === 1 || v === 2) return 0;
  if (v < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * v))) - lgamma(1 - v);
  if (v < 15) return Math.log(Math.abs(gamma(v)));
  const z = v - 1;
  const t = z + 7.5;
  return LOG_SQRT_2PI + (z + 0.5) * Math.log(t) - t + Math.log(lanczosSum(z));
}

/** numpy's rint: the nearest whole number, halves to the even one. */
export function rint(y: number): number {
  if (!Number.isFinite(y) || Math.abs(y) >= 2 ** 52) return y;
  const f = Math.floor(y);
  const d = y - f;
  const r = d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1;
  return r === 0 && (y < 0 || Object.is(y, -0)) ? -0 : r;
}

const roundAt = atDigits(rint, "round");

export function round(v: number, n = 0): number {
  return roundAt(v, n);
}

// ── numpy's legacy RandomState: MT19937 + random_sample / standard_normal ──

/** The Mersenne Twister exactly as numpy.random.RandomState seeds and draws it. */
export class Mt19937 {
  private readonly mt = new Uint32Array(624);
  private i = 624;
  private gauss: number | null = null;

  constructor(seed: number) {
    this.mt[0] = seed >>> 0;
    for (let k = 1; k < 624; k++) {
      const prev = this.mt[k - 1] ^ (this.mt[k - 1] >>> 30);
      this.mt[k] = (Math.imul(1812433253, prev) + k) >>> 0;
    }
  }

  private twist(): void {
    const mt = this.mt;
    for (let k = 0; k < 624; k++) {
      const y = (mt[k] & 0x80000000) | (mt[(k + 1) % 624] & 0x7fffffff);
      mt[k] = mt[(k + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
    }
    this.i = 0;
  }

  nextUint32(): number {
    if (this.i >= 624) this.twist();
    let y = this.mt[this.i++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** random_sample(): a 53-bit double in [0, 1). */
  random(): number {
    const a = this.nextUint32() >>> 5;
    const b = this.nextUint32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** standard_normal(): numpy's legacy polar (Marsaglia) method, which hands
   *  out its two values second-first. */
  normal(): number {
    if (this.gauss !== null) {
      const g = this.gauss;
      this.gauss = null;
      return g;
    }
    let x1: number;
    let x2: number;
    let r2: number;
    do {
      x1 = 2 * this.random() - 1;
      x2 = 2 * this.random() - 1;
      r2 = x1 * x1 + x2 * x2;
    } while (r2 >= 1 || r2 === 0);
    const f = Math.sqrt((-2 * Math.log(r2)) / r2);
    this.gauss = f * x1;
    return f * x2;
  }
}

export type RandomKind = "uniform" | "normal";

/** Why `seed` cannot seed RandomState, or null when it can. */
export function seedProblem(seed: number): string | null {
  return Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff ? null : `the seed must be a whole number from 0 to 4294967295, not ${seed}`;
}

/** The first `n` draws of RandomState(seed).random_sample / standard_normal. */
export function randomSeries(kind: RandomKind, seed: number, n: number): number[] {
  const why = seedProblem(seed);
  if (why) throw new Error(why);
  const g = new Mt19937(seed);
  return Array.from({ length: n }, () => (kind === "uniform" ? g.random() : g.normal()));
}

// ── interp(v, X, Y) ───────────────────────────────────────────────────────

export interface InterpTable {
  xp: number[];
  fp: number[];
}

/** The lookup table X→Y: blank pairs dropped, put in increasing X. Throws when
 *  X is not strictly monotonic. */
export function interpTable(xs: readonly number[], ys: readonly number[], xName: string): InterpTable {
  const xp: number[] = [];
  const fp: number[] = [];
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(xs[i]) || Number.isNaN(ys[i])) continue;
    xp.push(xs[i]);
    fp.push(ys[i]);
  }
  const rising = xp.every((v, i) => i === 0 || v > xp[i - 1]);
  const falling = !rising && xp.every((v, i) => i === 0 || v < xp[i - 1]);
  if (!rising && !falling)
    throw new Error(`interp(): column ${xName} must be strictly increasing or strictly decreasing — sort the worksheet by it, or remove repeated values`);
  return falling ? { xp: xp.reverse(), fp: fp.reverse() } : { xp, fp };
}

/** numpy.interp(v, xp, fp, left=nan, right=nan) on an increasing table. */
export function interpAt(t: InterpTable, v: number): number {
  const { xp, fp } = t;
  const n = xp.length;
  if (Number.isNaN(v) || n === 0 || v < xp[0] || v > xp[n - 1]) return NaN;
  if (v === xp[n - 1]) return fp[n - 1];
  let lo = 0;
  let hi = n - 1; // xp[lo] <= v < xp[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xp[mid] <= v) lo = mid;
    else hi = mid;
  }
  if (v === xp[lo]) return fp[lo];
  const slope = (fp[hi] - fp[lo]) / (xp[hi] - xp[lo]);
  const r = slope * (v - xp[lo]) + fp[lo];
  return Number.isNaN(r) ? slope * (v - xp[hi]) + fp[hi] : r;
}

/** The plain (per-row, argument-only) half of the additions above. */
export const MATH_FUNCS: Record<string, (...a: number[]) => number> = {
  erf,
  erfc,
  gamma,
  lgamma,
  round: (v, n) => round(v, n ?? 0),
};

/** The row-aware half, parsed by lib/formulaSpecial.ts. */
export const SPECIAL_NAMES = new Set(["rnd", "normal", "interp"]);
