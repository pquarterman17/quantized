// The top (secondary) X axis of gap #5: a second X axis along the top of the
// plot whose labels show a transform of the bottom axis -- 1/T beside T,
// d-spacing beside 2θ, or any linear map. Pure; the screen draws it through
// `lib/axisStyleExtras.ts` and the export through `calc/axis_top.py`, which
// ports this module line for line so both pick the SAME tick values and
// labels (tests/test_axis_top.py and axisTop.test.ts share one table).
//
// The ticks are nice numbers in the TRANSFORMED unit (0.002, 0.0025, ...),
// placed where the bottom axis has the matching value -- so on a reciprocal
// or d-spacing axis they are unevenly spaced, as in Origin.

import type { TopAxis } from "./axisFormat";

export interface TopTick {
  /** Where the tick sits, in bottom-axis (x) units. */
  pos: number;
  /** The transformed value it shows. */
  value: number;
  label: string;
}

/** About this many ticks across the axis (both renderers use the same). */
export const TOP_TICK_TARGET = 8;
/** Closest two top-axis labels may sit, as a fraction of the axis length. */
export const TOP_MIN_GAP = 0.05;

/** Where a transform is undefined at one end of the axis (1/x at 0, d-spacing
 *  at 0 or 180 deg), the drawn part starts this fraction of its upper end
 *  above zero. Mirrors TOP_SPAN_FLOOR in calc/axis_top.py. */
export const TOP_SPAN_FLOOR = 0.01;
const DSPACING_MAX = 179.99;

const DEG = Math.PI / 180;

/** x -> the top axis' value, or NaN outside the transform's domain. */
export function topForward(top: TopAxis, x: number): number {
  const factor = top.factor ?? 1;
  if (top.kind === "reciprocal") return x === 0 ? NaN : factor / x;
  if (top.kind === "linear") return factor * x + (top.shift ?? 0);
  const lam = top.wavelength ?? NaN;
  return x > 0 && x < 180 ? lam / (2 * Math.sin((x / 2) * DEG)) : NaN;
}

/** The top axis' value -> x, or NaN outside the domain. */
export function topInverse(top: TopAxis, t: number): number {
  const factor = top.factor ?? 1;
  if (top.kind === "reciprocal") return t === 0 ? NaN : factor / t;
  if (top.kind === "linear") return factor === 0 ? NaN : (t - (top.shift ?? 0)) / factor;
  const r = (top.wavelength ?? NaN) / (2 * t);
  return t > 0 && r <= 1 ? (2 * Math.asin(r)) / DEG : NaN;
}

/** Nice tick values covering [a, b] (either order): steps of 1, 2, 2.5 or 5
 *  times a power of ten, about `target` of them. Returns the values and the
 *  decimals their labels need. */
export function niceTicks(a: number, b: number, target = TOP_TICK_TARGET): { values: number[]; decimals: number } {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return { values: [], decimals: 0 };
  const raw = (hi - lo) / target;
  const exp = Math.floor(Math.log10(raw));
  const mag = 10 ** exp;
  const mult = [1, 2, 2.5, 5, 10].find((m) => m * mag >= raw * (1 - 1e-9)) ?? 10;
  const step = mult * mag;
  const decimals = Math.max(0, -exp + (mult === 2.5 ? 1 : 0) - (mult === 10 ? 1 : 0));
  const values: number[] = [];
  for (let k = Math.ceil(lo / step - 1e-9); k <= Math.floor(hi / step + 1e-9); k++) values.push(Number((k * step).toPrecision(12)));
  return { values, decimals: Math.min(decimals, 12) };
}

/** A tick label: `value` to `decimals` places, never "-0". */
export function topLabel(value: number, decimals: number): string {
  const s = value.toFixed(decimals);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

/** The part of the bottom axis [min, max] where the transform is finite and
 *  monotonic, or null when no part is (1/x needs x > 0; d-spacing needs
 *  0 < x < 180). A range running into the singularity keeps only its valid
 *  side, starting a small fraction of the way in so the mapped range is finite. */
export function topSpan(top: TopAxis, min: number, max: number): [number, number] | null {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (top.kind === "linear") return [lo, hi];
  const upper = top.kind === "reciprocal" ? hi : top.kind === "dspacing" ? Math.min(hi, DSPACING_MAX) : NaN;
  if (!Number.isFinite(lo) || !Number.isFinite(upper) || upper <= 0 || lo >= upper) return null;
  return [lo > 0 ? lo : upper * TOP_SPAN_FLOOR, upper];
}

/** The top axis' ticks for a bottom axis showing [min, max]: only the part of
 *  the axis inside the transform's domain gets ticks, none when no part does. */
export function topTicks(top: TopAxis, min: number, max: number): TopTick[] {
  const valid = topSpan(top, min, max);
  if (!valid) return [];
  const span = Math.max(min, max) - Math.min(min, max); // label spacing is measured on the whole axis
  const [lo, hi] = valid;
  const { values, decimals } = niceTicks(topForward(top, lo), topForward(top, hi));
  const out: TopTick[] = [];
  for (const value of values) {
    const pos = topInverse(top, value);
    if (Number.isFinite(pos) && pos >= lo - span * 1e-9 && pos <= hi + span * 1e-9) out.push({ pos, value, label: topLabel(value, decimals) });
  }
  out.sort((p, q) => p.pos - q.pos);
  // Uneven (reciprocal / d-spacing) ticks bunch up at one end: keep a tick only
  // when it sits at least TOP_MIN_GAP of the axis from the last kept one, so
  // labels never overlap. Mirrored in calc/axis_top.py.
  const kept: TopTick[] = [];
  for (const tick of out) if (kept.length === 0 || tick.pos - kept[kept.length - 1].pos >= span * TOP_MIN_GAP - span * 1e-9) kept.push(tick);
  return kept;
}

/** Why `top` cannot be drawn (missing wavelength, zero factor), or null. */
export function topAxisProblem(top: TopAxis): string | null {
  if (top.kind === "dspacing" && !(top.wavelength && top.wavelength > 0)) return "A d-spacing top axis needs a wavelength (Å).";
  if (top.kind !== "dspacing" && top.factor === 0) return "The top-axis factor cannot be 0.";
  return null;
}

/** Why `top` shows nothing over the X limits typed so far, or null. Only a
 *  range with no valid part at all is a problem; a range that merely touches
 *  the singularity draws its valid side. */
export function topRangeProblem(top: TopAxis, min: number | null, max: number | null): string | null {
  const hi = max ?? min;
  if (hi === null || !Number.isFinite(hi)) return null;
  const lo = min ?? max ?? hi;
  if (top.kind === "reciprocal" && topSpan(top, lo, hi) === null) return "1/T needs X > 0.";
  if (top.kind === "dspacing" && topSpan(top, lo, hi) === null) return "d-spacing needs 0 < 2θ < 180°.";
  return null;
}
