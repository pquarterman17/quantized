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

/** The top axis' ticks for a bottom axis showing [min, max]. Empty when
 *  either end lies outside the transform's domain. */
export function topTicks(top: TopAxis, min: number, max: number): TopTick[] {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const ta = topForward(top, lo);
  const tb = topForward(top, hi);
  // A reciprocal axis across x = 0 has no finite image.
  if (top.kind === "reciprocal" && lo <= 0 && hi >= 0) return [];
  const { values, decimals } = niceTicks(ta, tb);
  const span = hi - lo;
  const out: TopTick[] = [];
  for (const value of values) {
    const pos = topInverse(top, value);
    if (Number.isFinite(pos) && pos >= lo - span * 1e-9 && pos <= hi + span * 1e-9) out.push({ pos, value, label: topLabel(value, decimals) });
  }
  return out.sort((p, q) => p.pos - q.pos);
}

/** Why `top` cannot be drawn (missing wavelength, zero factor), or null. */
export function topAxisProblem(top: TopAxis): string | null {
  if (top.kind === "dspacing" && !(top.wavelength && top.wavelength > 0)) return "A d-spacing top axis needs a wavelength (Å).";
  if (top.kind !== "dspacing" && top.factor === 0) return "The top-axis factor cannot be 0.";
  return null;
}
