// Probability distributions for the worksheet formula language (plan item 28,
// element-wise half). LAZY chunk: lib/formulaRefs.ts puts `DIST_FUNCS` in the
// extension's function table. Numerics: lib/formulaDistNumerics.ts. Each one
// has a scipy.stats twin in calc/column_formula_dist.py (the headless export
// runs it), and lib/__fixtures__/formulaDist.json pins both to the same grid.
//
// Names and argument order are Origin's (LTF/Default/Functions.xml, OriginC
// ocStats.h). Origin lacks some of the names (tpdf, chi2pdf, fpdf, expcdf,
// expinv ...); those follow the same pattern. Parameterisations:
//
//   normpdf(x, mu, sigma)         density, mean mu, standard deviation sigma
//   normcdf(x [, tail])           STANDARD normal (Origin takes no mu, sigma)
//   norminv(p)                    standard normal quantile
//   tpdf(x, df)  tcdf(t, df [, tail])  tinv(p, df)       Student t, df > 0
//   chi2pdf(x, df)  chi2cdf(x, df [, tail])  chi2inv(p, df)
//   fpdf(x, df1, df2)  fcdf(f, df1, df2 [, tail])  finv(p, df1, df2)
//   gampdf(x, a, b)  gamcdf(x, a, b [, tail])  gaminv(p, a, b)
//                                 gamma, SHAPE a, SCALE b (mean a*b)
//   betapdf(x, a, b)  betacdf(x, a, b [, tail])  betainv(p, a, b)   on [0, 1]
//   lognpdf(x, mu, sigma)  logncdf(x, mu, sigma [, tail])  logninv(p, mu, sigma)
//                                 mu, sigma are the mean and standard deviation
//                                 of ln(x), not of x
//   wblpdf(x, a, b)  wblcdf(x, a, b)  wblinv(p, a, b)
//                                 Weibull, SCALE a, SHAPE b (Origin's wblcdf
//                                 has no tail; here an optional 4th is accepted)
//   exppdf(x, lambda)  expcdf(x, lambda [, tail])  expinv(p, lambda)
//                                 exponential with RATE lambda (mean 1/lambda),
//                                 as Origin's exppdf. expcdf / expinv are not
//                                 in Origin; they follow its rate convention
//                                 (MATLAB's take the mean instead).
//   poisspdf(k, lambda)  poisscdf(k, lambda)             Poisson, lambda >= 0
//   binopdf(k, n, p)  binocdf(k, n, p)                   binomial, n whole >= 0
//
// tail (Origin's codes): 2 = lower, the default; 1 = upper (1 - cdf, computed
// without cancellation). Origin's 0 = two-tailed is not implemented and, like
// any other value, is an error. The discrete functions take a whole k: pdf of
// a non-whole k is 0 (scipy / MATLAB; Origin's C int would truncate), cdf of a
// non-whole k is the cdf at floor(k).
//
// Out-of-domain parameters (sigma <= 0, df <= 0, p outside [0, 1], ...) and a
// blank (NaN) argument give a blank result, as scipy does. No new dependency.

import { lgamma } from "./formulaMath";
import { betaIQ, gammaPQ, invert, lbeta, normInv, normPair, normPdf, type Pair } from "./formulaDistNumerics";

type Fn = (...a: number[]) => number;
type N = number | undefined;

const pick = (p: Pair, tail: N): number => {
  if (tail === undefined || tail === 2) return p[0];
  if (Number.isNaN(tail)) return NaN;
  if (tail === 1) return p[1];
  throw new Error("tail must be 1 (upper tail) or 2 (lower tail, the default)");
};
const pos = (...v: N[]): boolean => v.every((x) => x !== undefined && x > 0);
const bad = NaN;
const anyNaN = (...v: number[]): boolean => v.some((x) => Number.isNaN(x));

// ── gamma family (chi-square shares it) ─────────────────────────────────

const gammaPair =
  (a: number, b: number) =>
  (x: number): Pair =>
    gammaPQ(a, x / b);
function gamPdf(x: number, a: number, b: number): number {
  if (!pos(a, b) || Number.isNaN(x)) return bad;
  if (x < 0) return 0;
  if (x === 0) return a < 1 ? Infinity : a === 1 ? 1 / b : 0;
  return Math.exp((a - 1) * Math.log(x) - x / b - lgamma(a) - a * Math.log(b));
}
function gamInv(p: number, a: number, b: number): number {
  if (!pos(a, b) || Number.isNaN(p)) return bad;
  const z = normInv(p);
  const t = 1 - 1 / (9 * a) + z / (3 * Math.sqrt(a));
  let x0 = a * t * t * t; // Wilson-Hilferty
  if (!(x0 > 0)) x0 = Math.exp(Math.log(p) / a + lgamma(a + 1) / a);
  if (!(x0 > 0 && Number.isFinite(x0))) x0 = a;
  return b * invert(gammaPair(a, 1), (x) => gamPdf(x, a, 1), p, 0, Infinity, x0);
}

// ── beta ────────────────────────────────────────────────────────────────

function betaPdf(x: number, a: number, b: number): number {
  if (!pos(a, b) || Number.isNaN(x)) return bad;
  if (x < 0 || x > 1) return 0;
  if (x === 0) return a < 1 ? Infinity : a === 1 ? b : 0;
  if (x === 1) return b < 1 ? Infinity : b === 1 ? a : 0;
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log1p(-x) - lbeta(a, b));
}
function betaInv(p: number, a: number, b: number): number {
  if (!pos(a, b) || Number.isNaN(p)) return bad;
  return invert((x) => betaIQ(a, b, x), (x) => betaPdf(x, a, b), p, 0, 1, a / (a + b));
}

// ── Student t ───────────────────────────────────────────────────────────

function tPair(t: number, df: number): Pair {
  if (!pos(df) || Number.isNaN(t)) return [bad, bad];
  if (t === Infinity) return [1, 0];
  if (t === -Infinity) return [0, 1];
  const two = betaIQ(df / 2, 0.5, df / (df + t * t))[0]; // P(|T| > |t|)
  return t < 0 ? [two / 2, 1 - two / 2] : [1 - two / 2, two / 2];
}
function tPdf(t: number, df: number): number {
  if (!pos(df) || Number.isNaN(t)) return bad;
  const lg = lgamma((df + 1) / 2) - lgamma(df / 2) - 0.5 * Math.log(df * Math.PI);
  return Math.exp(lg - ((df + 1) / 2) * Math.log1p((t * t) / df));
}
function tInv(p: number, df: number): number {
  if (!pos(df) || Number.isNaN(p)) return bad;
  if (p === 0.5) return 0;
  const z = normInv(p);
  return invert((x) => tPair(x, df), (x) => tPdf(x, df), p, -Infinity, Infinity, z * (1 + (1 + z * z) / (4 * df)));
}

// ── F ───────────────────────────────────────────────────────────────────

function fPair(f: number, d1: number, d2: number): Pair {
  if (!pos(d1, d2) || Number.isNaN(f)) return [bad, bad];
  if (f <= 0) return [0, 1];
  if (f === Infinity) return [1, 0];
  const w = d1 * f;
  if (w < d2) return betaIQ(d1 / 2, d2 / 2, w / (w + d2));
  const r = betaIQ(d2 / 2, d1 / 2, d2 / (w + d2));
  return [r[1], r[0]];
}
function fPdf(x: number, d1: number, d2: number): number {
  if (!pos(d1, d2) || Number.isNaN(x)) return bad;
  if (x < 0) return 0;
  if (x === 0) return d1 < 2 ? Infinity : d1 === 2 ? 1 : 0;
  const w = d1 * x;
  return Math.exp(0.5 * (d1 * Math.log(w) + d2 * Math.log(d2) - (d1 + d2) * Math.log(w + d2)) - Math.log(x) - lbeta(d1 / 2, d2 / 2));
}

// ── discrete ────────────────────────────────────────────────────────────

const whole = (k: number): boolean => Number.isInteger(k);
function poissPdf(k: number, l: number): number {
  if (Number.isNaN(k) || Number.isNaN(l) || !(l >= 0)) return bad;
  if (!whole(k) || k < 0) return 0;
  if (l === 0) return k === 0 ? 1 : 0;
  return Math.exp(k * Math.log(l) - l - lgamma(k + 1));
}
const binoOk = (n: number, p: number): boolean => whole(n) && n >= 0 && p >= 0 && p <= 1;
function binoPdf(k: number, n: number, p: number): number {
  if (Number.isNaN(k) || !binoOk(n, p)) return bad;
  if (!whole(k) || k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1) + k * Math.log(p) + (n - k) * Math.log1p(-p));
}
function binoCdf(k: number, n: number, p: number): number {
  if (Number.isNaN(k) || !binoOk(n, p)) return bad;
  if (k < 0) return 0;
  const kf = Math.floor(k);
  if (kf >= n || p === 0) return 1;
  if (p === 1) return 0;
  return betaIQ(n - kf, kf + 1, 1 - p)[0]; // the lower tail directly: no 1 - (almost 1)
}

// ── lognormal / Weibull / exponential helpers ──────────────────────────

const lognZ = (x: number, mu: number, s: number): number => (Math.log(x) - mu) / s;
const wblU = (x: number, a: number, b: number): number => Math.pow(x / a, b);
const unit = (p: number): boolean => p >= 0 && p <= 1;

export const DIST_FUNCS: Record<string, Fn> = {
  normpdf: (x, mu, s) => (pos(s) && !anyNaN(x, mu) ? normPdf((x - mu) / s) / s : bad),
  normcdf: (x, tail) => pick(normPair(x), tail),
  norminv: (p) => normInv(p),
  tpdf: tPdf,
  tcdf: (t, df, tail) => pick(tPair(t, df), tail),
  tinv: tInv,
  chi2pdf: (x, df) => (pos(df) ? gamPdf(x, df / 2, 2) : bad),
  chi2cdf: (x, df, tail) => (pos(df) ? pick(gammaPair(df / 2, 2)(x), tail) : bad),
  chi2inv: (p, df) => (pos(df) ? gamInv(p, df / 2, 2) : bad),
  fpdf: fPdf,
  fcdf: (f, d1, d2, tail) => pick(fPair(f, d1, d2), tail),
  finv: (p, d1, d2) => (!pos(d1, d2) ? bad : invert((x) => fPair(x, d1, d2), (x) => fPdf(x, d1, d2), p, 0, Infinity, 1)),
  gampdf: gamPdf,
  gamcdf: (x, a, b, tail) => (pos(a, b) ? pick(gammaPair(a, b)(x), tail) : bad),
  gaminv: gamInv,
  betapdf: betaPdf,
  betacdf: (x, a, b, tail) => pick(betaIQ(a, b, x), tail),
  betainv: betaInv,
  lognpdf: (x, mu, s) => (!pos(s) || anyNaN(x, mu) ? bad : x <= 0 ? 0 : normPdf(lognZ(x, mu, s)) / (x * s)),
  logncdf: (x, mu, s, tail) => (!pos(s) || anyNaN(x, mu) ? bad : pick(x <= 0 ? [0, 1] : normPair(lognZ(x, mu, s)), tail)),
  logninv: (p, mu, s) => (!pos(s) || anyNaN(p, mu) ? bad : Math.exp(mu + s * normInv(p))),
  wblpdf: (x, a, b) => {
    if (!pos(a, b) || Number.isNaN(x)) return bad;
    if (x < 0) return 0;
    if (x === 0) return b < 1 ? Infinity : b === 1 ? 1 / a : 0;
    return (b / a) * Math.pow(x / a, b - 1) * Math.exp(-wblU(x, a, b));
  },
  wblcdf: (x, a, b, tail) => {
    if (!pos(a, b) || Number.isNaN(x)) return bad;
    const u = x <= 0 ? 0 : wblU(x, a, b);
    return pick([-Math.expm1(-u), Math.exp(-u)], tail);
  },
  wblinv: (p, a, b) => (!pos(a, b) || !unit(p) ? bad : a * Math.pow(-Math.log1p(-p), 1 / b)),
  exppdf: (x, l) => (!pos(l) || Number.isNaN(x) ? bad : x < 0 ? 0 : l * Math.exp(-l * x)),
  expcdf: (x, l, tail) => (!pos(l) || Number.isNaN(x) ? bad : pick(x <= 0 ? [0, 1] : [-Math.expm1(-l * x), Math.exp(-l * x)], tail)),
  expinv: (p, l) => (!pos(l) || !unit(p) ? bad : -Math.log1p(-p) / l),
  poisspdf: poissPdf,
  poisscdf: (k, l) => (Number.isNaN(k) || Number.isNaN(l) || !(l >= 0) ? bad : k < 0 ? 0 : k === Infinity ? 1 : gammaPQ(Math.floor(k) + 1, l)[1]),
  binopdf: binoPdf,
  binocdf: binoCdf,
};
