// The Axis dialog's extra scales and tick rules (gap audit 4 G17) as pure
// math, shared by the canvas (`lib/axisScaleExtras.ts`) and checked against
// the export's twin (`calc/axis_scales.py`) through the wire fixture
// `tests/fixtures/wire/axis_scales.json`, so screen and export agree on every
// position, tick, label and range:
//   log2         a log axis with majors at powers of 2 (`AxisFormat.base "2"`);
//   probability  a linear axis positioned by the normal quantile (probit) of
//                a fraction in (0, 1) or a percent in (0, 100) (`prob`);
//   custom       explicit major positions, optionally labelled (`custom`);
//   cross        the axis drawn across the other axis at a value (`cross`).
// A value outside a scale's domain is never drawn and never coerced.

import type { AxisFormat, CustomTicks } from "./axisFormat";

export type ProbUnit = NonNullable<AxisFormat["prob"]>;

/** Origin's probability-axis majors, in percent. */
export const PROB_TICKS_PCT: readonly number[] = [0.01, 0.1, 1, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 99.9, 99.99];

const scaleOf = (unit: ProbUnit): number => (unit === "percent" ? 100 : 1);

/** Is `v` inside the probability axis' open domain? */
export const inProbDomain = (v: number, unit: ProbUnit): boolean => Number.isFinite(v) && v > 0 && v < scaleOf(unit);

/** erfc(x), W. J. Cody's rational approximations (|rel err| < 1e-15), so the
 *  probit's forward and backward maps invert each other to the pixel. */
function erfc(x: number): number {
  const ax = Math.abs(x);
  let r: number;
  if (ax < 0.5) {
    const t = x * x;
    const p = (((0.1857777061846031526730 * t + 3.161123743870565596947) * t + 113.8641541510501556495) * t + 377.4852376853020208137) * t + 3209.377589138469472562;
    const q = (((t + 23.60129095234412093499) * t + 244.0246379344441733056) * t + 1282.616526077372275645) * t + 2844.236833439170622273;
    return 1 - (x * p) / q;
  }
  if (ax < 4) {
    const p = (((((((2.15311535474403846343e-8 * ax + 0.564188496988670089180) * ax + 8.88314979438837594118) * ax + 66.1191906371416294775) * ax + 298.635138197400131132) * ax + 881.952221241769090411) * ax + 1712.04761263407058314) * ax + 2051.07837782607146532) * ax + 1230.33935479799725272;
    const q = (((((((ax + 15.7449261107098347253) * ax + 117.693950891312499305) * ax + 537.181101862009857509) * ax + 1621.38957456669018874) * ax + 3290.79923573345962678) * ax + 4362.61909014324715820) * ax + 3439.36767414372163696) * ax + 1230.33935480374942043;
    r = Math.exp(-ax * ax) * (p / q);
  } else {
    const z = 1 / (ax * ax);
    const p = ((((0.0163153871373020978498 * z + 0.305326634961232344035) * z + 0.360344899949804439429) * z + 0.125781726111229246204) * z + 0.0160837851487422766278) * z + 6.58749161529837803157e-4;
    const q = ((((z + 2.56852019228982242072) * z + 1.87295284992346725209) * z + 0.527905102951428412248) * z + 0.0605183413124413191178) * z + 2.33520497626869185443e-3;
    r = (Math.exp(-ax * ax) / ax) * (0.564189583547756286948 - (z * p) / q);
  }
  return x < 0 ? 2 - r : r;
}

/** The standard normal CDF. */
export const normCdf = (z: number): number => 0.5 * erfc(-z / Math.SQRT2);

/** The standard normal quantile (Acklam's algorithm, one Halley step). */
export function normInv(p: number): number {
  if (!(p > 0 && p < 1)) return NaN;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  let x: number;
  if (p < lo || p > 1 - lo) {
    const q = Math.sqrt(-2 * Math.log(p < lo ? p : 1 - p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    if (p > 1 - lo) x = -x;
  } else {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const e = normCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

/** A probability axis' position of `v` (NaN off the domain: not drawn). */
export const probForward = (v: number, unit: ProbUnit): number => (inProbDomain(v, unit) ? normInv(v / scaleOf(unit)) : NaN);

/** The value at probability-axis position `z`. */
export const probBackward = (z: number, unit: ProbUnit): number => normCdf(z) * scaleOf(unit);

const EPS = 1e-9;

/** The auto range of a probability axis over in-domain data `[lo, hi]`
 *  (null = no in-domain data): out to the nearest standard majors. */
export function probAutoRange(lo: number | null, hi: number | null, unit: ProbUnit): [number, number] {
  const k = scaleOf(unit);
  const std = PROB_TICKS_PCT.map((t) => (t / 100) * k);
  if (lo === null || hi === null) return [std[0], std[std.length - 1]];
  let a = std[0];
  for (const t of std) if (t <= lo * (1 + EPS)) a = t;
  let b = std[std.length - 1];
  for (let i = std.length - 1; i >= 0; i--) if (std[i] >= hi * (1 - EPS)) b = std[i];
  if (!(b > a)) {
    const i = std.indexOf(a);
    return [std[Math.max(0, i - 1)], std[Math.min(std.length - 1, i + 1)]];
  }
  return [a, b];
}

/** 1, 2 or 5 x 10^n at or above `raw`. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const mag = Number(`1e${Math.floor(Math.log10(raw))}`);
  const n = raw / mag;
  return (n <= 1 + EPS ? 1 : n <= 2 + EPS ? 2 : n <= 5 + EPS ? 5 : 10) * mag;
}

/** A probability axis' majors inside `[min, max]`: the standard ones, or --
 *  on a view too narrow to hold two of them -- even steps of the value. */
export function probTicks(min: number, max: number, unit: ProbUnit): number[] {
  const [lo, hi] = min <= max ? [min, max] : [max, min];
  const k = scaleOf(unit);
  const inside = (v: number) => v >= lo - EPS * k && v <= hi + EPS * k && inProbDomain(v, unit);
  const std = PROB_TICKS_PCT.map((t) => Number(((t / 100) * k).toPrecision(12))).filter(inside);
  if (std.length >= 2 || !(hi > lo)) return std;
  const step = niceStep((hi - lo) / 4);
  const out: number[] = [];
  for (let n = Math.ceil(lo / step - EPS); n <= Math.floor(hi / step + EPS); n++) {
    const v = Number((n * step).toPrecision(12));
    if (inside(v)) out.push(v);
  }
  return out;
}

/** A plain number label (the export's `"%.12g"`, no exponent here). */
export const plainLabel = (v: number): string => String(Number(v.toPrecision(12)));

const SUP: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };

/** A log2 axis' majors in `[min, max]`: powers of 2, thinned to every k-th
 *  power (k a whole number) once there would be more than 12. */
export function log2Ticks(min: number, max: number): number[] {
  if (!(min > 0) || !(max > min)) return [];
  const k0 = Math.ceil(Math.log2(min) - EPS);
  const k1 = Math.floor(Math.log2(max) + EPS);
  const every = Math.max(1, Math.ceil((k1 - k0 + 1) / 12));
  const out: number[] = [];
  for (let k = Math.ceil(k0 / every) * every; k <= k1; k += every) out.push(2 ** k);
  return out;
}

/** A log2 major's label: the number for 2^-10..2^10, else 2 with a
 *  superscript exponent. */
export function log2Label(v: number): string {
  if (!(v > 0)) return "";
  const k = Math.round(Math.log2(v));
  return Math.abs(k) <= 10 ? plainLabel(v) : `2${String(k).replace(/[-0-9]/g, (c) => SUP[c])}`;
}

/** Can scale `scale` (with format `fmt`) draw the value `v` at all? */
export function drawableOn(v: number, scale: string, fmt: AxisFormat | null | undefined): boolean {
  if (!Number.isFinite(v)) return false;
  if (scale === "log" || scale === "reciprocal") return v > 0;
  if (scale === "linear" && fmt?.prob) return inProbDomain(v, fmt.prob);
  return true;
}

/** The custom majors (and their labels) inside `[min, max]` the axis can
 *  draw. A blank or missing label is null: the axis' own number. */
export function customTicksIn(c: CustomTicks, min: number, max: number, ok: (v: number) => boolean): { at: number[]; labels: (string | null)[] } {
  const [lo, hi] = min <= max ? [min, max] : [max, min];
  const tol = (hi - lo) * EPS;
  const pairs = c.at
    .map((v, i) => ({ v, label: c.labels?.[i]?.trim() ? c.labels[i] : null }))
    .filter(({ v }) => v >= lo - tol && v <= hi + tol && ok(v))
    .sort((a, b) => a.v - b.v);
  return { at: pairs.map((p) => p.v), labels: pairs.map((p) => p.label) };
}

/** Where a crossing axis sits along the other axis, whose view is
 *  `[min, max]`: `cross` clamped into the view, or null when the other axis
 *  cannot draw it (e.g. 0 on a log axis), which leaves the axis at its frame. */
export function crossPosition(cross: number, min: number, max: number, drawable: boolean): number | null {
  if (!drawable || !Number.isFinite(cross) || !Number.isFinite(min) || !Number.isFinite(max)) return null;
  const [lo, hi] = min <= max ? [min, max] : [max, min];
  return Math.min(hi, Math.max(lo, cross));
}
