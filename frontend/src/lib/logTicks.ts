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
  const positive = splits.filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  return positive.length >= 2 && Math.max(...positive) / Math.min(...positive) >= 10 * (1 - 1e-9);
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
    if (k === 0 || k === 1) return String(10 ** k);
    return `10${String(k).replace("-", "⁻").replace(/\d/g, (d) => SUPERSCRIPT[Number(d)])}`;
  });
}

/** Keep labels only on decade anchors while retaining 2-9 subdivisions as
 * splits for log grid lines and tick marks. Sub-decade Origin axes use their
 * decoded arithmetic step, so every split remains a labeled major tick. */
export function logMajorTickFilter(_u: uPlot, splits: number[]): (number | null)[] {
  if (!spansDecade(splits)) return splits;
  return splits.map((v) => (v > 0 && decadeOf(v) !== null ? v : null));
}
