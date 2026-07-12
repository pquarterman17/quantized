// Split a dataset by a column's value into per-group child datasets
// (MAIN_PLAN #26) — pure grouping model, no store/React so it's unit-testable
// in isolation (see datasetsplit.test.ts). The use case: one imported file
// holds measurements at many setpoints (M-H loops at 5/10/50/100 K in a
// single PPMS export) — this turns it into per-setpoint datasets, the
// prerequisite for overlays/panels/waterfalls/batch fits.
//
// Two grouping strategies, dispatched by the column's MODELING TYPE
// (lib/modeling.ts's inferModelingType — the same continuous/nominal/ordinal
// inference the worksheet's categorical-axis logic already uses):
//   - continuous (a real measurement, e.g. a setpoint temperature/field):
//     GAP-CLUSTERING (`clusterByGaps`) — sort the values, start a new group
//     whenever the gap to the previous value exceeds `tolerance`. A PPMS/
//     MPMS setpoint column never repeats EXACTLY (controller wobble reads
//     back 4.998/5.001/5.003 K around a 5 K setpoint) but repeats
//     APPROXIMATELY, so exact-value grouping would produce one group per
//     row; gap-clustering with a tolerance derived from the column's own
//     spacing (`autoTolerance`) closes that gap.
//   - nominal/ordinal (few discrete levels, each used many times — a run
//     index, a 0/1 flag, a sample id encoded as a small integer): EXACT-
//     VALUE grouping (`groupByExactValue`) — no tolerance needed or shown,
//     every occurrence of the same number is the same group by definition.
// Both return the SAME `SplitGroup[]` shape (`SplitResult`) so the dialog
// and the store action never need to know which strategy produced a group.
//
// Column addressing follows `ColumnFilter.col`'s existing convention
// (lib/types.ts): -1 = the x/time column, 0.. = a value channel.

import { fmtNum } from "./format";
import { inferModelingType } from "./modeling";
import type { DataStruct } from "./types";

export interface SplitGroup {
  /** Display + dataset-naming label: the group's representative value
   *  formatted through the house number formatter plus the column's unit
   *  ("5 K", "0.1 T") — or "(other)" for the non-finite catch-all group. */
  label: string;
  /** The group's representative raw value: the CLUSTER MEDIAN for a
   *  gap-clustered continuous group (robust to wobble, unlike the mean —
   *  a single outlier read can't drag it), or the exact shared value for
   *  an exact-value group. NaN for the "(other)" non-finite catch-all. */
  value: number;
  /** Original row indices belonging to this group, ascending — so a
   *  sliced child dataset preserves the source's acquisition order. */
  rowIndexes: number[];
}

export interface SplitResult {
  groups: SplitGroup[];
  /** The tolerance actually used for gap-clustering; null for exact-value
   *  grouping, where a tolerance is meaningless (shown/hidden by the dialog
   *  accordingly). */
  tolerance: number | null;
}

/** Above this many groups, a split is almost certainly a mis-picked column
 *  (a continuous sweep, not a real setpoint — e.g. picking the field column
 *  of an M-H loop, which is unique-ish per row) rather than a genuine
 *  multi-setpoint file. Exported so the dialog and its tests share one
 *  number instead of a magic literal drifting between them. */
export const SPLIT_GROUP_CAP = 50;

/** True when `groups` is too many to usefully preview/split — the dialog's
 *  cue to render a warning instead of the live per-group list (discoverability
 *  cuts both ways: showing 300 one-row "groups" is worse than showing none). */
export function tooManyGroups(groups: readonly SplitGroup[]): boolean {
  return groups.length > SPLIT_GROUP_CAP;
}

/** Minimum ratio between two consecutive SORTED gaps to count as a decisive
 *  "elbow" — the boundary between a within-cluster wobble population and a
 *  between-cluster jump population. Below this, the gap sequence reads as
 *  homogeneous (a uniform ramp, or wobble with no second cluster at all):
 *  there's no data-driven separation to find, so `autoTolerance` treats the
 *  whole spread as one cluster. This gates whether a separation is
 *  DECISIVE, not the tolerance value itself — no magic multiplier applied
 *  to a physical unit anywhere below. */
const ELBOW_RATIO_THRESHOLD = 3;

/** A cluster boundary's "small" (wobble) side needs at least this many gaps
 *  before they're trusted as an actual wobble POPULATION rather than one
 *  small-but-still-real jump that merely lost a 1-vs-1 magnitude contest.
 *  Bug-hunt repro: `[5,5,5,10,10,300]` has only 3 distinct values (2 gaps:
 *  5 and 290) — the 5 is smaller than the 290, but nothing establishes it's
 *  WOBBLE rather than a second, smaller jump (there is zero wobble in this
 *  data: every repeat is an exact duplicate, gap 0, already excluded). With
 *  only 1 gap on the small side there's no evidence either way, so
 *  `autoTolerance` doesn't merge — see `MIN_DISTINCT_FOR_ELBOW` below for
 *  the same reasoning applied before an elbow can even be computed. */
const MIN_WOBBLE_POPULATION = 2;

/** Minimum distinct finite values needed to even ATTEMPT elbow detection
 *  (need at least 2 gaps to compute one ratio). Below this: 0 or 1 distinct
 *  values have no gaps at all (nothing can ever split, any tolerance works
 *  — see `clusterByGaps`); 2 distinct values give exactly one gap and
 *  nothing to compare it against, so — same bias as
 *  `MIN_WOBBLE_POPULATION` — there's no evidence to justify merging them,
 *  and `autoTolerance` doesn't. */
const MIN_DISTINCT_FOR_ELBOW = 3;

/** Derive a default gap-clustering tolerance from the column's OWN value
 *  spacing (MAIN_PLAN #26) — deliberately no fixed constant in physical
 *  units, since a temperature column and a field column need wildly
 *  different absolute tolerances.
 *
 *  ELBOW DETECTION (bug-hunt fix — replaces a median-of-all-gaps ×8
 *  heuristic that MERGED distinct setpoints with few rows per setpoint:
 *  with only a handful of repeats, the within-setpoint "wobble" gaps and
 *  the between-setpoint "jump" gaps are comparable in COUNT, so the median
 *  landed between the two populations and ×8 was enough to swallow a real
 *  boundary — e.g. `[5, 5.001, 10, 10.002, 500]` used to merge 5 K and
 *  10 K into one "7.5005 K" blob). Algorithm: take the adjacent gaps
 *  between the column's SORTED DISTINCT finite values, sort THOSE gaps by
 *  magnitude, and find the pair of consecutive sorted gaps with the
 *  largest RATIO — that's the elbow separating the wobble population
 *  (every gap at/below it) from the jump population (every gap at/above
 *  it). The tolerance is the geometric mean of the two gaps straddling the
 *  elbow (scale-appropriate for spacings that span orders of magnitude, and
 *  strictly between the two populations by construction).
 *
 *  Two guards keep this from mis-firing on data that ISN'T bimodal — see
 *  their own doc comments for the reasoning:
 *   - `MIN_DISTINCT_FOR_ELBOW` / `MIN_WOBBLE_POPULATION`: not enough
 *     evidence of a genuine wobble population → don't merge (tolerance 0,
 *     every remaining distinct value becomes its own group).
 *   - `ELBOW_RATIO_THRESHOLD`: the best ratio found isn't decisive (all
 *     gaps comparable in magnitude) → merge everything (tolerance = the
 *     largest gap; `clusterByGaps` only splits on a STRICT `>`, so nothing
 *     in a homogeneous set can exceed its own max).
 *  Finite values only; fewer than `MIN_DISTINCT_FOR_ELBOW` distinct finite
 *  values yields 0. */
export function autoTolerance(values: readonly number[]): number {
  const distinct = [...new Set(values.filter((v) => Number.isFinite(v)))].sort((a, b) => a - b);
  if (distinct.length < MIN_DISTINCT_FOR_ELBOW) return 0;

  const gaps: number[] = [];
  for (let i = 1; i < distinct.length; i++) gaps.push(distinct[i] - distinct[i - 1]);
  const sortedGaps = [...gaps].sort((a, b) => a - b);

  let bestRatio = -Infinity;
  let bestI = -1;
  for (let i = 0; i < sortedGaps.length - 1; i++) {
    const r = sortedGaps[i + 1] / sortedGaps[i];
    if (r > bestRatio) {
      bestRatio = r;
      bestI = i;
    }
  }

  if (bestRatio < ELBOW_RATIO_THRESHOLD) return sortedGaps[sortedGaps.length - 1];
  if (bestI + 1 < MIN_WOBBLE_POPULATION) return 0;
  return Math.sqrt(sortedGaps[bestI] * sortedGaps[bestI + 1]);
}

/** Format a group's representative value for display/naming: the house
 *  formatter's sig-figs/notation prefs, plus the column's unit when it has
 *  one ("5 K", "0.1 T"). Exported so the dialog's live list renders the
 *  EXACT text the resulting dataset gets named with — no drift between
 *  preview and outcome. */
export function formatGroupLabel(value: number, unit: string): string {
  const n = fmtNum(value);
  return unit ? `${n} ${unit}` : n;
}

/** Median of a non-empty numeric array that is ALREADY sorted ascending. */
function medianOfSorted(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Gap-cluster a continuous column (MAIN_PLAN #26): sort finite values
 *  ascending, start a new group whenever the gap to the previous value
 *  exceeds `tolerance` (so `tolerance <= 0` degenerates to exact-value
 *  grouping — a repeat's gap is exactly 0, which never exceeds any
 *  tolerance >= 0, so `tolerance === 0` still merges true repeats while
 *  splitting every distinct value; a negative tolerance would split even
 *  repeats, which the dialog's numeric field guards against by clamping to
 *  >= 0). Non-finite (NaN/Infinity) rows never join a numeric cluster —
 *  a cluster's label is a MEDIAN, which a NaN would poison — they land in
 *  one trailing "(other)" group instead of being silently dropped, so the
 *  split always accounts for every source row; omitted entirely when there
 *  are none. `unit` only affects display labels, never the clustering math.
 *  Groups are emitted in ascending-value order regardless of input order
 *  (the internal sort makes the result order-independent — see the
 *  "descending data" test). */
export function clusterByGaps(
  values: readonly number[],
  tolerance: number,
  unit = "",
): SplitResult {
  const finite: { v: number; i: number }[] = [];
  const other: number[] = [];
  values.forEach((v, i) => {
    if (Number.isFinite(v)) finite.push({ v, i });
    else other.push(i);
  });
  finite.sort((a, b) => a.v - b.v);

  const groups: SplitGroup[] = [];
  let cur: { v: number; i: number }[] = [];
  const flush = (): void => {
    if (!cur.length) return;
    const vals = cur.map((c) => c.v).sort((a, b) => a - b);
    const value = medianOfSorted(vals);
    const rowIndexes = cur
      .map((c) => c.i)
      .sort((a, b) => a - b);
    groups.push({ label: formatGroupLabel(value, unit), value, rowIndexes });
    cur = [];
  };
  for (const entry of finite) {
    if (cur.length && entry.v - cur[cur.length - 1].v > tolerance) flush();
    cur.push(entry);
  }
  flush();

  if (other.length) {
    groups.push({ label: "(other)", value: Number.NaN, rowIndexes: [...other].sort((a, b) => a - b) });
  }
  return { groups, tolerance };
}

/** Exact-value grouping for a discrete/categorical column (nominal/ordinal
 *  modeling type, or a `label`-role channel) — no tolerance, no cluster
 *  math: groups are emitted in FIRST-APPEARANCE order (the natural "level
 *  order" a user recognizes, e.g. run 1 before run 2 before run 3, not an
 *  arbitrary numeric sort). NaN rows still collect into a trailing
 *  "(other)" group, the same convention `clusterByGaps` uses. */
export function groupByExactValue(values: readonly number[], unit = ""): SplitResult {
  const order: number[] = [];
  const byValue = new Map<number, number[]>();
  const other: number[] = [];
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) {
      other.push(i);
      return;
    }
    if (!byValue.has(v)) {
      byValue.set(v, []);
      order.push(v);
    }
    byValue.get(v)!.push(i);
  });
  const groups: SplitGroup[] = order.map((v) => ({
    label: formatGroupLabel(v, unit),
    value: v,
    rowIndexes: byValue.get(v)!,
  }));
  if (other.length) groups.push({ label: "(other)", value: Number.NaN, rowIndexes: other });
  return { groups, tolerance: null };
}

/** Column value extractor honoring the `-1 = x, 0.. = channel` convention
 *  shared with `ColumnFilter.col` (lib/types.ts). */
export function columnValues(data: DataStruct, col: number): number[] {
  return col < 0 ? [...data.time] : data.values.map((row) => row[col]);
}

/** Column unit honoring the same `-1 = x` convention. The x/time column
 *  carries no unit on `DataStruct` (only channels do), so this returns ""
 *  for it — callers wanting an x label use the dataset's own x-axis label. */
export function columnUnit(data: DataStruct, col: number): string {
  return col < 0 ? "" : (data.units[col] ?? "");
}

/** True when `col` should use exact-value grouping (nominal/ordinal
 *  modeling type) rather than gap-clustering. The x/time column is always
 *  treated as continuous — a categorical x is not a modeled scenario
 *  today (lib/modeling.ts only infers types for value channels). */
export function isCategoricalColumn(data: DataStruct, col: number): boolean {
  if (col < 0) return false;
  return inferModelingType(data.values.map((row) => row[col])) !== "continuous";
}

/** The ONE entry point the dialog + store action both call: groups `col`
 *  (x or a value channel) by value, dispatching to exact-value grouping
 *  for a categorical column (`tolerance` ignored) or gap-clustering (at
 *  `tolerance`, defaulting to `autoTolerance`) for a continuous one.
 *  `tolerance` is guarded here (defense-in-depth against a bad caller, e.g.
 *  a dialog with unvalidated numeric-field text): non-finite (`NaN`,
 *  `Infinity`) or negative falls back to `autoTolerance` exactly like
 *  omitting it — `tolerance ?? autoTolerance(...)` alone only catches
 *  `null`/`undefined`, not `NaN` (a `NaN` tolerance makes every gap
 *  comparison `> ` false, silently collapsing everything to one group) or a
 *  negative one (every gap, even a same-value repeat's gap of exactly 0,
 *  exceeds it, silently exploding into one group per row). */
export function splitColumn(data: DataStruct, col: number, tolerance?: number): SplitResult {
  const values = columnValues(data, col);
  const unit = columnUnit(data, col);
  if (isCategoricalColumn(data, col)) return groupByExactValue(values, unit);
  const tol =
    tolerance !== undefined && Number.isFinite(tolerance) && tolerance >= 0
      ? tolerance
      : autoTolerance(values);
  return clusterByGaps(values, tol, unit);
}

/** Cheap "how setpoint-like is this column" score for the dialog's default
 *  column pick — LOWER is better; `Infinity` marks a column that can't
 *  usefully split (≤1 group: nothing to split, or every row its own
 *  group would be worse than useless). Fewer groups reads as more
 *  setpoint-like (a 4-level temperature column beats a near-continuous
 *  field column, which groups into hundreds under the same math). */
function setpointScore(data: DataStruct, col: number): number {
  const n = splitColumn(data, col).groups.length;
  return n > 1 ? n : Infinity;
}

/** Pick a sensible default split column for the dialog (MAIN_PLAN #26):
 *  the value channel whose cheap grouping looks most setpoint-like (fewest
 *  groups, so long as it splits into more than one) — e.g. a 4-level
 *  temperature column beats a near-continuous field column. Falls back to
 *  the FIRST value channel when nothing looks setpoint-like (every column
 *  is single-valued or highly fragmented — `setpointScore` is `Infinity`
 *  for all of them). Never the x/time column: a PPMS/MPMS-style export
 *  loops the SAME x sweep (e.g. field) once per setpoint, so x itself is
 *  essentially never the split key. Returns a channel index (0-based,
 *  into `DataStruct.values`), or -1 if `data` has no channels at all (a
 *  degenerate/empty dataset — the caller should disable the picker). */
export function pickDefaultSplitColumn(data: DataStruct): number {
  const n = data.labels.length;
  if (n === 0) return -1;
  let best = 0;
  let bestScore = Infinity;
  for (let c = 0; c < n; c++) {
    const score = setpointScore(data, c);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Slice a DataStruct's time+values rows down to `rowIndexes` (any order —
 *  typically ascending, straight from a `SplitGroup`) into a fresh,
 *  non-aliased DataStruct. labels/units/metadata are structural (per-
 *  COLUMN, not per-row) so they're copied whole, unaffected by which rows
 *  survive — this is the "per-row-safe fields" the store's
 *  `splitDatasetByColumn` action builds each child dataset's `data` from. */
export function sliceDataStruct(data: DataStruct, rowIndexes: readonly number[]): DataStruct {
  return {
    time: rowIndexes.map((i) => data.time[i]),
    values: rowIndexes.map((i) => [...data.values[i]]),
    labels: [...data.labels],
    units: [...data.units],
    metadata: { ...data.metadata },
  };
}
