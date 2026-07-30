// Tabulate (ORIGIN_GAP #55; v2 = JMP_GAP_PLAN J6) — group value column(s) by
// the distinct levels of up to 3 NESTED "by" columns and compute a chosen stat
// set per group x value (the JMP "Tabulate" / Origin "statistics by group"
// summary). Pure: numbers in -> summary rows out, so it's fully unit-tested
// and honors row exclusion by simply receiving the pruned columns
// (lib/rowstate.analysisData) from the caller.
//
// v1 (`tabulate`/`AGG_KEYS`/`GroupSummaryRow`, one group x one value x a fixed
// six aggregates) is kept verbatim below — no existing caller/test needs to
// change. v2 (`tabulateNested`/`STAT_KEYS`/`GroupStats`/`TabRow`) is the
// nested-grouping, multi-value, expanded-stat-catalog extension the Tabulate
// workshop now drives (useTabulate.ts); category LABEL resolution (text vs
// numeric-coded levels) needs the owning DataStruct/metadata, so it stays in
// the hook (`lib/barlayout.resolveCategoryLabels`), not here.

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

function median(sorted: readonly number[]): number {
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

// ── v2: nested grouping, multiple value columns, expanded stat catalog ──────

/** The full v2 stat catalog, in display order. `count`/`mean`/`sd`/`min`/`max`/
 *  `median` keep their v1 names and semantics verbatim; `sem` is the standard
 *  error of the mean (sample sd / sqrt(n), so it shares `sd`'s NaN-below-n=2
 *  rule); `sum` is the plain finite-value total; `q1`/`q3` are the 25th/75th
 *  percentiles via linear interpolation between closest ranks (numpy's
 *  default "linear" method / Excel PERCENTILE.INC) — a documented choice, not
 *  necessarily JMP's own quantile method (that exactness is J12's concern). */
export const STAT_KEYS = [
  "count",
  "mean",
  "sd",
  "sem",
  "min",
  "max",
  "median",
  "sum",
  "q1",
  "q3",
] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export type GroupStats = Record<StatKey, number>;

/** Linear-interpolation percentile (`p` in [0, 1]) of an ascending-sorted
 *  array. NaN on empty input; the single value on a 1-element input. */
function percentile(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return sorted[0];
  const rank = p * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const frac = rank - lo;
  return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
}

/** Descriptive stats for one bucket of (already-finite-filtered) values. An
 *  empty bucket (a real, observed group with zero finite values for THIS
 *  value column — see `tabulateNested`'s doc for why that can happen) reports
 *  `count: 0` and NaN everywhere else, same "real cell, no data" shape JMP's
 *  Tabulate shows as "." rather than dropping the row. */
export function computeStats(vals: readonly number[]): GroupStats {
  const count = vals.length;
  if (count === 0) {
    return {
      count: 0,
      mean: Number.NaN,
      sd: Number.NaN,
      sem: Number.NaN,
      min: Number.NaN,
      max: Number.NaN,
      median: Number.NaN,
      sum: Number.NaN,
      q1: Number.NaN,
      q3: Number.NaN,
    };
  }
  const sum = vals.reduce((a, b) => a + b, 0);
  const mean = sum / count;
  const variance =
    count > 1 ? vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (count - 1) : Number.NaN;
  const sd = Math.sqrt(variance);
  const sem = count > 1 ? sd / Math.sqrt(count) : Number.NaN;
  const sorted = [...vals].sort((a, b) => a - b);
  return {
    count,
    mean,
    sd,
    sem,
    min: sorted[0],
    max: sorted[count - 1],
    median: median(sorted),
    sum,
    q1: percentile(sorted, 0.25),
    q3: percentile(sorted, 0.75),
  };
}

export interface TabRow {
  /** Numeric level code per nested group column, depth-first order, outermost
   *  first (e.g. `[lotCode, waferCode]`). `[]` for the optional grand-total
   *  row — see `isTotal`. Numeric only: resolving these to text category
   *  labels needs the owning DataStruct/metadata, so it happens in the
   *  caller (lib/barlayout.resolveCategoryLabels), not here. */
  levels: number[];
  /** Per-value-column stats, same order as the `valueCols` argument. */
  values: GroupStats[];
  /** True for the single optional grand-total row (every finite value across
   *  the whole column, ignoring grouping entirely) — `levels` is `[]` for it. */
  isTotal?: boolean;
}

export interface TabulateNestedOptions {
  /** Append a trailing grand-total row. Default false. */
  grandTotal?: boolean;
}

/** Group `valueCols` by the distinct OBSERVED combinations of `groupCols`
 *  (1..3 columns; array order = nesting depth, outermost first), computing
 *  the full v2 stat catalog per group x value column. Columns are truncated
 *  to the shortest of all of them (mirrors v1).
 *
 *  A row contributes to a group only when ALL of that row's group-column
 *  values are finite (an ungrouped row is skipped entirely, like v1). Once a
 *  group exists, each value column then collects its OWN finite values
 *  independently — one value column being non-finite on a row does not drop
 *  that row from another value column's stats. That's a deliberate departure
 *  from v1 (whose single group x single value never even creates a group
 *  whose one value is non-finite): with multiple value columns a group is a
 *  real, observed thing, and a value column having no finite data in it
 *  should read as an empty cell (`computeStats([])`), not make the whole row
 *  disappear out from under the OTHER value columns that do have data there.
 *
 *  Rows are returned depth-first: sorted ascending by the first group column,
 *  ties broken by the second, then the third. */
export function tabulateNested(
  groupCols: readonly (readonly number[])[],
  valueCols: readonly (readonly number[])[],
  opts: TabulateNestedOptions = {},
): TabRow[] {
  if (groupCols.length === 0) return [];
  const lengths = [...groupCols, ...valueCols].map((c) => c.length);
  const n = lengths.length ? Math.min(...lengths) : 0;

  const buckets = new Map<string, { levels: number[]; perValue: number[][] }>();
  for (let i = 0; i < n; i++) {
    const levels = groupCols.map((c) => c[i]);
    if (levels.some((v) => !Number.isFinite(v))) continue;
    const key = levels.join(" ");
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { levels, perValue: valueCols.map(() => []) };
      buckets.set(key, bucket);
    }
    for (let vi = 0; vi < valueCols.length; vi++) {
      const v = valueCols[vi][i];
      if (Number.isFinite(v)) bucket.perValue[vi].push(v);
    }
  }

  const rows: TabRow[] = [...buckets.values()]
    .map(({ levels, perValue }) => ({ levels, values: perValue.map(computeStats) }))
    .sort((a, b) => {
      for (let d = 0; d < a.levels.length; d++) {
        if (a.levels[d] !== b.levels[d]) return a.levels[d] - b.levels[d];
      }
      return 0;
    });

  if (opts.grandTotal) {
    const totals: number[][] = valueCols.map(() => []);
    for (let i = 0; i < n; i++) {
      for (let vi = 0; vi < valueCols.length; vi++) {
        const v = valueCols[vi][i];
        if (Number.isFinite(v)) totals[vi].push(v);
      }
    }
    rows.push({ levels: [], values: totals.map(computeStats), isTotal: true });
  }

  return rows;
}
