// Conditional-format rules that depend on the whole column: duplicates,
// outliers (Tukey fences) and top / bottom N or N%. Rule shapes and their
// sanitizer: lib/worksheetRulesModel.ts. One pass over a column's finite values
// builds a matcher per rule; the grid then asks it per drawn cell.
//
// Missing, NaN and infinite cells never match any of these (and never count
// towards a column's statistics): they have no rank and no value to repeat.

import type { StatRule } from "./worksheetRulesModel";

/** True when a cell meets the rule; takes the cell's value as the grid has it. */
export type StatMatcher = (v: number | undefined) => boolean;

/** Quantile of ascending `sorted` at fraction `q`, by linear interpolation. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** The outlier fences of `sorted`, or null with fewer than four values (an
 *  IQR from three points is not a rule worth stating). */
export function iqrFences(sorted: readonly number[], k: number): { lo: number; hi: number } | null {
  if (sorted.length < 4) return null;
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  return { lo: q1 - k * (q3 - q1), hi: q3 + k * (q3 - q1) };
}

/** How many values a rank rule selects out of `count` (percent: floor, at
 *  least one; a count is capped at the column's size). */
export function rankCount(rule: Extract<StatRule, { kind: "rank" }>, count: number): number {
  const n = rule.percent ? Math.floor((count * rule.n) / 100) : Math.round(rule.n);
  return Math.min(count, Math.max(1, n));
}

const finite = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v);

/** The matcher of one rule over a column's finite values (any order). */
export function statMatcher(rule: StatRule, finiteValues: readonly number[]): StatMatcher {
  if (rule.kind === "duplicate") {
    const seen = new Set<number>();
    const dup = new Set<number>();
    for (const v of finiteValues) (seen.has(v) ? dup : seen).add(v);
    return (v) => finite(v) && dup.has(v);
  }
  const sorted = [...finiteValues].sort((a, b) => a - b);
  if (rule.kind === "outlier") {
    const f = iqrFences(sorted, rule.k);
    return (v) => f !== null && finite(v) && (v < f.lo || v > f.hi);
  }
  if (sorted.length === 0) return () => false;
  const n = rankCount(rule, sorted.length);
  if (rule.end === "top") {
    const cut = sorted[sorted.length - n];
    return (v) => finite(v) && v >= cut;
  }
  const cut = sorted[n - 1];
  return (v) => finite(v) && v <= cut;
}

export const isStatRule = (r: { kind: string }): r is StatRule => r.kind === "duplicate" || r.kind === "outlier" || r.kind === "rank";
