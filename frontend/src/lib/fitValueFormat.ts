// Fit-result number formatting, pure. The ONE rule for "value ± error" that the
// Curve Fit result panel, its copy-to-clipboard tables and the graph's fit
// table layer (lib/fitTableLayer.ts) all share, so they cannot disagree.
//
// The error is rounded by the Particle Data Group convention: take its three
// leading digits; 100-354 keeps two significant figures, 355-949 keeps one, and
// 950-999 rounds up to one figure of the next power of ten. The value is then
// rounded to the same decimal place. 9 ± 0.0123 prints "9.000 ± 0.012", never
// "9 ± 8.73258e-12". A value/error pair at a very large or small magnitude
// shares one exponent: (5.4 ± 1.4)×10⁻¹³.

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const wide = (a: number) => a !== 0 && (a < 1e-3 || a >= 1e5);

/** An error needing more decimals, or a value more significant figures, than
 *  this is far below the value's own precision (an exact fit): printing them
 *  all would be noise. */
export const MAX_DECIMALS = 15;
const MAX_SIG = 10;

export interface Rounded {
  /** Decimals both numbers print with (negative = rounded to tens, hundreds). */
  dec: number;
  /** Shared power of ten the pair is divided by (0 = none). */
  mag: number;
  value: string;
  error: string;
}

/** Significant figures PDG keeps on an error whose leading digits are `n3` (100-999). */
const pdgDigits = (n3: number): 1 | 2 => (n3 <= 354 ? 2 : 1);

/** `v` and `e` rounded together, or null when `e` is not a usable positive
 *  number or sits so far below `v` that no decimals can show both. */
export function roundToError(v: number, e: number): Rounded | null {
  if (!fin(v) || !fin(e) || e <= 0) return null;
  const top = Math.max(Math.abs(v), e);
  const mag = wide(top) ? Math.floor(Math.log10(top)) : 0;
  const ee = e / 10 ** mag;
  const ve = v / 10 ** mag;
  const lead = Math.floor(Math.log10(ee));
  const n3 = Math.floor(ee / 10 ** (lead - 2) + 1e-9);
  const dec = pdgDigits(n3) - 1 - lead;
  // The value would need more than 10 significant figures: an exact fit.
  if (dec > MAX_DECIMALS || dec + Math.max(0, Math.floor(Math.log10(Math.abs(ve) || 1)) + 1) > MAX_SIG) return null;
  if (dec >= 0) return { dec, mag, value: ve.toFixed(dec), error: ee.toFixed(dec) };
  const unit = 10 ** -dec;
  return { dec, mag, value: String(Math.round(ve / unit) * unit), error: String(Math.round(ee / unit) * unit) };
}

const SUP: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
/** 10 raised to `n` as "×10⁻¹³". */
export const timesTen = (n: number): string => `×10${[...String(n)].map((c) => SUP[c] ?? c).join("")}`;

/** A statistic to `sig` significant figures; scientific when very large/small. */
export function sigFigs(v: unknown, sig = 4): string {
  if (!fin(v)) return "—";
  if (wide(Math.abs(v))) return v.toExponential(sig - 1).replace("e+", "e");
  return String(Number(v.toPrecision(sig)));
}

/** "2.327 ± 0.012", "(5.4 ± 1.4)×10⁻¹³". With no usable error the value alone
 *  at four figures, so it cannot read as exact. */
export function fmtValueErr(v: unknown, e: unknown): string {
  if (!fin(v)) return "—";
  const r = fin(e) ? roundToError(v, e) : null;
  if (!r) return sigFigs(v, 4);
  const body = `${r.value} ± ${r.error}`;
  return r.mag === 0 ? body : `(${body})${timesTen(r.mag)}`;
}

/** R² to five decimals; "1 − 3e-7" when that would round to 1.00000 and
 *  "≈1 (exact)" at machine precision, so a near-perfect fit never reads "1". */
export function fmtR2(r2: unknown): string {
  if (!fin(r2)) return "—";
  const gap = 1 - r2;
  if (gap < 1e-12 && gap > -1e-12) return "≈1 (exact)";
  if (gap > 0 && gap < 5e-6) return `1 − ${gap.toExponential(1)}`;
  return r2.toFixed(5);
}

/** True when R² is 1 to machine precision (the errors are then not meaningful). */
export const isExactFit = (r2: unknown): boolean => fin(r2) && Math.abs(1 - r2) < 1e-12;

// ── Student t, for the confidence interval ──────────────────────────────────

function lgamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const t = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let s = 1.000000000190015;
  for (const cj of c) s += cj / ++y;
  return -t + Math.log((2.5066282746310005 * s) / x);
}

/** Continued fraction of the regularized incomplete beta function. */
function betacf(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  d = 1 / (Math.abs(d) < tiny ? tiny : d);
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; d = 1 / (Math.abs(d) < tiny ? tiny : d);
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; d = 1 / (Math.abs(d) < tiny ? tiny : d);
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return h;
}

function betaInc(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** The two-sided Student-t critical value: P(|T| > t) = 1 − level, `dof` degrees
 *  of freedom. Null without a positive dof. */
export function tCritical(level: number, dof: number): number | null {
  if (!fin(dof) || dof < 1 || !(level > 0 && level < 1)) return null;
  const alpha = 1 - level;
  let lo = 0;
  let hi = 1e3;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const tail = betaInc(dof / 2, 0.5, dof / (dof + mid * mid)); // P(|T| > mid)
    if (tail > alpha) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** `value ± t·error` limits at `level`, or null without a dof or usable error. */
export function confidenceLimits(v: unknown, e: unknown, dof: number, level = 0.95): [number, number] | null {
  const t = tCritical(level, dof);
  if (t == null || !fin(v) || !fin(e) || e <= 0) return null;
  return [v - t * e, v + t * e];
}

/** The interval's two limits printed to the ERROR's decimals (so they match the
 *  value ± error beside them) and the shared power of ten; null when there is
 *  no interval (no dof, no usable error, or an exact-fit error). */
export function limitParts(v: unknown, e: unknown, dof: number, level = 0.95): { lo: string; hi: string; mag: number } | null {
  const lim = confidenceLimits(v, e, dof, level);
  const r = lim && fin(v) && fin(e) ? roundToError(v, e) : null;
  if (!lim || !r) return null;
  const s = 10 ** r.mag;
  const f = (x: number) => (r.dec >= 0 ? (x / s).toFixed(r.dec) : String(Math.round(x / s / 10 ** -r.dec) * 10 ** -r.dec));
  return { lo: f(lim[0]), hi: f(lim[1]), mag: r.mag };
}

/** "[8.975, 9.025]", "[1.2, 3.4]×10⁻⁷"; "—" when there is no interval. */
export function fmtLimits(v: unknown, e: unknown, dof: number, level = 0.95): string {
  const p = limitParts(v, e, dof, level);
  if (!p) return "—";
  return `[${p.lo}, ${p.hi}]${p.mag === 0 ? "" : timesTen(p.mag)}`;
}
