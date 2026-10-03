// Log-axis tick LABELS, split out of lib/uplotOpts.ts (its shrink-only size
// pin). Positions stay there (`fixedLogAxisSplits`); this module only decides
// which splits carry text and what that text is.

import type uPlot from "uplot";

import { decimalsForIncrement, pow10 } from "./ticks";

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** "10" with `k` in superscript digits (10², 10⁻³). */
const tenTo = (k: number) => `10${String(k).replace("-", "⁻").replace(/\d/g, (d) => SUPERSCRIPT[+d])}`;

/** Exact decade exponent of `v`, or null when `v` is not a power of ten. */
function decadeOf(v: number): number | null {
  const exp = Math.log10(v);
  const k = Math.round(exp);
  return Math.abs(exp - k) < 1e-9 ? k : null;
}

const positiveOf = (splits: readonly (number | null)[]) =>
  splits.filter((v): v is number => Number.isFinite(v) && v! > 0);

/** True when the positive splits span at least one full decade. */
export function spansDecade(splits: readonly (number | null)[]): boolean {
  const positive = positiveOf(splits);
  return positive.length >= 2 && Math.max(...positive) / Math.min(...positive) >= 9.99999999;
}

/** Sub-decade labels for magnitudes whose plain digits would run long
 *  (>= 1e6 or < 1e-4): mantissa x 10^k in each value's own decade, with just
 *  enough mantissa digits for the tick spacing. Null for ordinary magnitudes. */
function scaledLabels(splits: readonly (number | null)[]): (string | null)[] | null {
  const positive = positiveOf(splits).sort((a, b) => a - b);
  if (!positive.length || (positive[positive.length - 1] < 1e6 && positive[0] >= 1e-4)) return null;
  const incr = Math.min(...positive.slice(1).map((v, i) => v - positive[i]));
  return splits.map((v) => {
    if (!positiveOf([v]).length) return null;
    const k = Math.floor(Math.log10(v!) + 1e-9);
    const m = +(v! / pow10(k)).toFixed(decimalsForIncrement(incr / pow10(k)));
    return m === 1 ? tenTo(k) : `${m}×${tenTo(k)}`;
  });
}

/** Publication-style labels for an automatic logarithmic axis: on a view that
 *  spans at least a decade, only the decade anchors carry text (1, 10, 10²,
 *  10⁻³, …) and the 2–9 subdivisions stay blank. A sub-decade view gets
 *  ordinary numeric labels (0.8/0.9/1.0), more useful than pretending every
 *  split is a power of ten: null hands those to the caller, except for huge or
 *  tiny magnitudes, labelled 1.5×10²² here (`scaledLabels`). */
export function logDecadeLabels(splits: readonly (number | null)[]): (string | null)[] | null {
  if (!spansDecade(splits)) return scaledLabels(splits);
  return splits.map((v) => {
    if (!positiveOf([v]).length) return null;
    const k = decadeOf(v!);
    if (k === null) return "";
    if (k === 0 || k === 1) return `${10 ** k}`;
    return tenTo(k);
  });
}

/** CSS px along axis `axisIdx` between `a` and `b`. */
const gapPx = (u: uPlot, axisIdx: number, a: number, b: number) => {
  const key = u.axes[axisIdx].scale!;
  return Math.abs(u.valToPos(a, key) - u.valToPos(b, key));
};

/** uPlot's default minimum label spacing: 50 px along x, 30 px along y/y2.
 *  calc/figure_log_ticks.py uses the same numbers. */
const space = (axisIdx: number) => (axisIdx ? 30 : 50);

/** Every n-th decade keeps its label so labels stay `space` apart. */
const decadeStride = (u: uPlot, axisIdx: number) => Math.ceil(space(axisIdx) / gapPx(u, axisIdx, 10, 1)) || 1;

/** Keep labels only on decade anchors while retaining 2-9 subdivisions as
 * splits for log grid lines and tick marks. When a decade is narrower than
 * uPlot's minimum label spacing, only every n-th decade (k % n == 0) keeps its
 * label, as uPlot's own log filter thins them. A sub-decade view's arithmetic
 * ticks (an Origin step, or `niceLinearStep`) are all labelled unless one
 * would sit closer than that spacing to the last label kept. */
export function logMajorTickFilter(u: uPlot, splits: number[], axisIdx: number): (number | null)[] {
  if (!spansDecade(splits)) {
    let last = NaN;
    return splits.map((v) => (last === last && gapPx(u, axisIdx, v, last) < space(axisIdx) ? null : (last = v)));
  }
  const n = decadeStride(u, axisIdx);
  return splits.map((v) => {
    const k = decadeOf(v); // null for v <= 0 too
    return k !== null && k % n === 0 ? v : null;
  });
}

/** Grid and tick positions for a log axis: the 2-9 subdivisions are dropped
 *  when the decade labels are thinned or the view spans more than six decades,
 *  where they only fill the plot with lines. Decades always stay. */
export function logGridSplits(u: uPlot, axisIdx: number, splits: number[]): number[] {
  // `fixedLogAxisSplits` output: positive and ascending.
  return spansDecade(splits) && (splits[splits.length - 1] / splits[0] > 1e6 || decadeStride(u, axisIdx) > 1)
    ? splits.filter((v) => decadeOf(v) !== null)
    : splits;
}
