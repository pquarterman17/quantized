// Tabulate (ORIGIN_GAP #55) — group a value column by the distinct levels of a
// "by" column and compute descriptive stats per group (the JMP "Tabulate" /
// Origin "statistics by group" summary). Pure: numbers in → summary rows out, so
// it's fully unit-tested and honors row exclusion by simply receiving the pruned
// columns (lib/rowstate.analysisData) from the caller.

/** One group's descriptive summary. `sd` is the SAMPLE standard deviation (n−1);
 *  it and `median` are NaN when the group has too few finite values. */
export interface GroupSummaryRow {
  group: number;
  count: number;
  mean: number;
  sd: number;
  min: number;
  max: number;
  median: number;
}

/** The aggregate columns a summary row carries, in display order (the `group`
 *  key is rendered separately as the first column). */
export const AGG_KEYS = ["count", "mean", "sd", "min", "max", "median"] as const;
export type AggKey = (typeof AGG_KEYS)[number];

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Group `value` by the distinct finite levels of `by`, computing per-group
 *  descriptive stats. A row is counted only when BOTH its group key and its
 *  value are finite (a non-finite in either is skipped — mirrors the worksheet's
 *  finite-only stats). Groups are returned sorted ascending by key. */
export function tabulate(
  by: readonly number[],
  value: readonly number[],
): GroupSummaryRow[] {
  const groups = new Map<number, number[]>();
  const n = Math.min(by.length, value.length);
  for (let i = 0; i < n; i++) {
    const k = by[i];
    const v = value[i];
    if (!Number.isFinite(k) || !Number.isFinite(v)) continue;
    const bucket = groups.get(k);
    if (bucket) bucket.push(v);
    else groups.set(k, [v]);
  }

  const rows: GroupSummaryRow[] = [];
  for (const [group, vals] of groups) {
    const count = vals.length;
    const sum = vals.reduce((a, b) => a + b, 0);
    const mean = sum / count;
    const variance =
      count > 1 ? vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (count - 1) : Number.NaN;
    const sorted = [...vals].sort((a, b) => a - b);
    rows.push({
      group,
      count,
      mean,
      sd: Math.sqrt(variance),
      min: sorted[0],
      max: sorted[count - 1],
      median: median(sorted),
    });
  }
  rows.sort((a, b) => a.group - b.group);
  return rows;
}
