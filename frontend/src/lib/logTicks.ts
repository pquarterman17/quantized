// Log-axis tick LABELS, split out of lib/uplotOpts.ts (its shrink-only size
// pin). Positions stay there (`fixedLogAxisSplits`); this module only decides
// which splits carry text and what that text is.

import type uPlot from "uplot";

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** Exact decade exponent of `v`, or null when `v` is not a power of ten. */
function decadeOf(v: number): number | null {
  const exp = Math.log10(v);
  const k = Math.round(exp);
  return Math.abs(exp - k) < 1e-9 ? k : null;
}

/** True when the positive splits span at least one full decade. */
function spansDecade(splits: readonly (number | null)[]): boolean {
  const positive = splits.filter((v): v is number => Number.isFinite(v) && v! > 0);
  return positive.length >= 2 && Math.max(...positive) / Math.min(...positive) >= 9.99999999;
}

/** Publication-style labels for an automatic logarithmic axis: on a view that
 *  spans at least a decade, only the decade anchors carry text (1, 10, 10²,
 *  10⁻³, …) and the 2–9 subdivisions stay blank. Returns null for a sub-decade
 *  view, where ordinary numeric labels (0.8/0.9/1.0) are more useful than
 *  pretending every split is a power of ten — the caller falls back to them. */
export function logDecadeLabels(splits: readonly (number | null)[]): (string | null)[] | null {
  if (!spansDecade(splits)) return null;
  return splits.map((v) => {
    if (v == null || !(v > 0) || !Number.isFinite(v)) return null;
    const k = decadeOf(v);
    if (k === null) return "";
    if (k === 0 || k === 1) return `${10 ** k}`;
    return `10${String(k).replace("-", "⁻").replace(/\d/g, (d) => SUPERSCRIPT[+d])}`;
  });
}

/** Keep labels only on decade anchors while retaining 2-9 subdivisions as
 * splits for log grid lines and tick marks. Sub-decade Origin axes use their
 * decoded arithmetic step, so every split remains a labeled major tick. When a
 * decade is narrower than uPlot's minimum label spacing, only every n-th
 * decade (k % n == 0) keeps its label, as uPlot's own log filter thins them. */
export function logMajorTickFilter(u: uPlot, splits: number[], axisIdx: number): (number | null)[] {
  if (!spansDecade(splits)) return splits;
  const key = u.axes[axisIdx].scale!;
  // uPlot's default minimum label spacing: 50 px along x, 30 px along y/y2.
  const n = Math.ceil((axisIdx ? 30 : 50) / Math.abs(u.valToPos(10, key) - u.valToPos(1, key))) || 1;
  return splits.map((v) => {
    const k = decadeOf(v); // null for v <= 0 too
    return k !== null && k % n === 0 ? v : null;
  });
}
