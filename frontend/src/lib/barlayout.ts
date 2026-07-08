// Grouped/stacked bar-chart math (ORIGIN_GAP_PLAN #20 categorical plots) plus
// the category-label resolution its RESOLVED decision calls for: an Origin
// text-label metadata column when one genuinely covers the categorical
// channel's levels, else formatted numeric levels. Pure — no React / store /
// fetch — consumed by lib/plotspec.ts (Graph Builder's bar mark) and
// Stage/useStatStage.ts (the stat stage's "bar" mode); rendered by
// Stage/statRender.ts (Canvas2D, the box/violin precedent). Category "slots"
// deliberately mirror lib/statstage.ts's categorySlots so bar/box/violin share
// the same axis geometry; groupedBarSlots is the extra sub-division a
// clustered bar chart needs within one category slot.

import type { DataStruct } from "./types";

const colValues = (data: DataStruct, index: number): number[] =>
  index < 0 ? data.time : data.values.map((row) => row[index]);

// ── Category levels + label resolution ──────────────────────────────────────

/** Distinct finite values of `channel`, ascending — the category levels. */
export function categoryLevels(data: DataStruct, channel: number): number[] {
  const vals = colValues(data, channel);
  return [...new Set(vals.filter((v) => Number.isFinite(v)))].sort((a, b) => a - b);
}

function isColumnStringsMap(v: unknown): v is Record<string, string[]> {
  return (
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.values(v as Record<string, unknown>).every((rows) => Array.isArray(rows))
  );
}

/** Origin short-name sort (A, B, …, Z, AA, AB, …): length then lexicographic,
 *  so keys stay deterministic across runs without decoding base-26. */
function sortColumnKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => a.length - b.length || a.localeCompare(b));
}

/** RESOLVED plan decision (b): look for a metadata inline-text column
 *  (`metadata.origin_text_columns`, `io/origin_project/opj.py` plan item 4)
 *  whose per-row strings are a CONSISTENT label for `channel`'s numeric
 *  levels — every row sharing one level maps to exactly one non-blank text
 *  value, and every level is covered. This is a general structural check
 *  (not an Origin-specific column-name match), so it works for any parser
 *  that leaves a text column in metadata. Returns null when no column
 *  qualifies (no text columns at all, a column disagrees with itself on some
 *  level, or a level has no text anywhere) — the caller falls back to
 *  formatted numeric levels. */
function textLabelsFor(
  data: DataStruct,
  channel: number,
  levels: readonly number[],
): string[] | null {
  const meta = data.metadata ?? {};
  const textCols = meta["origin_text_columns"];
  if (!isColumnStringsMap(textCols)) return null;
  const by = colValues(data, channel);
  for (const key of sortColumnKeys(Object.keys(textCols))) {
    const rows = textCols[key];
    const perLevel = new Map<number, string>();
    let ok = true;
    for (let r = 0; r < by.length && ok; r++) {
      if (!Number.isFinite(by[r])) continue;
      const text = String(rows[r] ?? "").trim();
      if (!text) continue; // a blank cell is uninformative, not disqualifying
      const seen = perLevel.get(by[r]);
      if (seen === undefined) perLevel.set(by[r], text);
      else if (seen !== text) ok = false;
    }
    if (!ok) continue;
    if (levels.length > 0 && levels.every((lvl) => perLevel.has(lvl))) {
      return levels.map((lvl) => perLevel.get(lvl) as string);
    }
  }
  return null;
}

/** Formatted-numeric fallback: whole numbers read as "1" not "1.0"; others
 *  get a compact fixed representation (6 significant figures). */
function formatLevel(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
}

/** Category tick labels for `channel`'s levels: an Origin text-label column
 *  when one consistently covers every level (RESOLVED decision b), else
 *  formatted numeric levels (decision a, the fallback). */
export function resolveCategoryLabels(
  data: DataStruct,
  channel: number,
  levels: readonly number[],
): string[] {
  return textLabelsFor(data, channel, levels) ?? levels.map(formatLevel);
}

// ── Per-series aggregate (mean ± SEM) ────────────────────────────────────────

export interface BarSeriesStat {
  mean: number;
  /** Standard error of the mean; NaN when n < 2 (no error bar drawable). */
  sem: number;
  n: number;
}

/** Mean + SEM (sample std-dev / sqrt(n), Bessel-corrected) of the finite
 *  values. `n===0` -> all-NaN (nothing to draw); `n===1` -> sem NaN (no
 *  spread to estimate) but mean is still a real bar height. */
export function seriesStat(values: readonly number[]): BarSeriesStat {
  const v = values.filter((x) => Number.isFinite(x));
  const n = v.length;
  if (n === 0) return { mean: NaN, sem: NaN, n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, sem: NaN, n };
  const variance = v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return { mean, sem: Math.sqrt(variance / n), n };
}

// ── Category x series matrix (the grouped/stacked bar data model) ───────────

export interface BarGroup {
  label: string;
  series: BarSeriesStat[]; // one per value channel, in `valueChannels` order
}

export interface BarChartData {
  groups: BarGroup[];
  seriesLabels: string[];
}

/** Build the category x series matrix: for each level of `groupCol`
 *  (ascending), for each channel in `valueChannels`, the mean±SEM of that
 *  channel's finite values on rows where `groupCol` equals that level. This
 *  is the grouped/stacked bar chart's data model — one BarGroup per category,
 *  one BarSeriesStat per series within it (length 1 = an ordinary single-
 *  series bar chart; >1 = clustered/stacked). `seriesLabels` is caller-
 *  supplied (the channel labels already resolved elsewhere) so this module
 *  stays free of DataStruct-label formatting concerns. */
export function buildBarMatrix(
  data: DataStruct,
  groupCol: number,
  valueChannels: readonly number[],
  seriesLabels: readonly string[],
): BarChartData {
  const by = colValues(data, groupCol);
  const levels = categoryLevels(data, groupCol);
  const labels = resolveCategoryLabels(data, groupCol, levels);
  const cols = valueChannels.map((c) => colValues(data, c));
  const groups: BarGroup[] = levels.map((lvl, i) => ({
    label: labels[i],
    series: cols.map((col) => {
      const vals: number[] = [];
      for (let r = 0; r < by.length; r++) {
        if (by[r] === lvl && Number.isFinite(col[r])) vals.push(col[r]);
      }
      return seriesStat(vals);
    }),
  }));
  return { groups, seriesLabels: [...seriesLabels] };
}

// ── Grouped-bar sub-slot geometry ────────────────────────────────────────────

export interface BarSlot {
  /** Offset from the category's centre, as a fraction of the category's own
   *  slot width — NOT the whole plot/axis width. Ranges over
   *  [-0.5+w/2, 0.5-w/2] for n series of width w=1/n, centered on 0. */
  offset: number;
  /** Half-width, same fraction-of-category-width units as `offset`. */
  halfWidth: number;
}

/** Evenly-spaced sub-slots for `n` clustered series within one category
 *  (grouped-bar mode): offsets are centered on the category (sum to zero for
 *  even/odd n alike), each bar leaving `gapFrac` of its own share as a gap
 *  from its neighbors. `n<=0` -> []; `n===1` -> one slot at offset 0 (an
 *  ordinary single-series bar, un-clustered). */
export function groupedBarSlots(n: number, gapFrac = 0.15): BarSlot[] {
  if (n <= 0) return [];
  const w = 1 / n;
  const halfWidth = (w * (1 - gapFrac)) / 2;
  return Array.from({ length: n }, (_, i) => ({
    offset: (i + 0.5) / n - 0.5,
    halfWidth,
  }));
}

// ── Stacked-bar cumulative geometry ──────────────────────────────────────────

export interface StackedSegment {
  /** Cumulative value BELOW this segment (0 for the first in the stack). */
  base: number;
  /** Cumulative value INCLUDING this segment. */
  top: number;
}

/** Cumulative [base, top] pairs for one category's series, stacked
 *  bottom-to-top in series order. A non-finite mean (e.g. an empty group,
 *  n=0) contributes 0 so one missing series doesn't break the rest of the
 *  stack. */
export function stackedSegments(series: readonly BarSeriesStat[]): StackedSegment[] {
  let running = 0;
  return series.map((s) => {
    const v = Number.isFinite(s.mean) ? s.mean : 0;
    const base = running;
    running += v;
    return { base, top: running };
  });
}

/** The top-of-stack value for each category (the tallest extent a stacked
 *  bar chart's y-domain must cover) — the stacked counterpart of scanning
 *  `mean+sem` across every series in grouped mode. */
export function stackedTotal(series: readonly BarSeriesStat[]): number {
  const segs = stackedSegments(series);
  return segs.length ? segs[segs.length - 1].top : 0;
}
