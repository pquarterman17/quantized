// The bar-chart math only lazy modules call, split out of `lib/barlayout.ts`
// (bundle diet slice 20, plans/BUNDLE_HEADROOM.md): the per-series mean ± SEM,
// the category x series matrix, and the grouped/stacked geometry. The eager
// graph needs barlayout.ts only for the category-label resolution; these serve
// the Stat Stage, its renderers and the Graph Builder's bar mark. Import them
// from this path, never re-exported through barlayout.ts: a re-export keeps
// them in barlayout's eager chunk (slice 18).

import { categoryLevels, columnOf } from "./categorical";
import { resolveCategoryLabels, type BarChartData, type BarGroup, type BarSeriesStat, type BarSlot, type StackedSegment } from "./barlayout";
import type { DataStruct } from "./types";

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
  const by = columnOf(data, groupCol);
  const levels = categoryLevels(data, groupCol);
  const labels = resolveCategoryLabels(data, groupCol, levels);
  const cols = valueChannels.map((c) => columnOf(data, c));
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
