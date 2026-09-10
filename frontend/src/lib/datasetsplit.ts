// Split a dataset by a column's value into per-group child datasets
// (MAIN_PLAN #26) — pure grouping model, no store/React so it's unit-testable
// in isolation (see datasetsplit.test.ts). The use case: one imported file
// holds measurements at many setpoints (M-H loops at 5/10/50/100 K in a
// single PPMS export) — this turns it into per-setpoint datasets, the
// prerequisite for overlays/panels/waterfalls/batch fits.
//
// Two grouping strategies, dispatched by the column's MODELING TYPE
// (lib/modeling.ts's `channelModelingType` — the SANCTIONED accessor, which
// honours the user's `channelTypes` override first, then an explicit
// `cat_levels` table, then the numeric-shape heuristic; BUG-008 was this
// module reaching past it straight to the raw `inferModelingType` heuristic,
// so a column `lib/byPartition.ts` OFFERS as categorical could still be
// gap-clustered here — two code paths, two answers to the same question):
//   - continuous (a real measurement, e.g. a setpoint temperature/field):
//     GAP-CLUSTERING (`clusterByGaps`) — sort the values, start a new group
//     whenever the gap to the previous value exceeds `tolerance`. A PPMS/
//     MPMS setpoint column never repeats EXACTLY (controller wobble reads
//     back 4.998/5.001/5.003 K around a 5 K setpoint) but repeats
//     APPROXIMATELY, so exact-value grouping would produce one group per
//     row; gap-clustering with a tolerance derived from the column's own
//     spacing (`autoTolerance`) closes that gap.
//   - nominal/ordinal (a level table, a user override, or few discrete
//     levels each used many times — a run index, a 0/1 flag, a sample id
//     encoded as a small integer): EXACT-VALUE grouping
//     (`groupByExactValue`) — no tolerance needed or shown, every
//     occurrence of the same number is the same group by definition. A
//     NAMED categorical column's groups are labelled with those names rather
//     than their raw float codes, so the child datasets read
//     "run.dat (B456)" and not "run.dat (1)". "Named" is decided by the app's
//     one canonical resolver, `lib/barlayout.ts`'s
//     `resolveCategoryLabelsOrNull` — a `cat_levels` level table first, then a
//     text-label sidecar (`metadata.text_columns`, else
//     `origin_text_columns`) that consistently covers every level. An Origin
//     `.opj` import is that second shape — numeric codes plus a sidecar and NO
//     `cat_levels` — but so is any delimited or SQLite import that leaves a
//     covering text column in metadata, so the sidecar source is NOT
//     Origin-specific.
//
//     WHY THIS IS INDEPENDENT OF WHY THE COLUMN IS CATEGORICAL (round-2
//     review, MEDIUM 3 — an earlier version of this comment claimed
//     otherwise): a column categorical only by the SHAPE HEURISTIC can still
//     carry a covering sidecar, and it is then named from it. That is
//     deliberate — `lib/byPartition.ts`, Tabulate, Data Filter and the stat
//     stage all label that same column from that same sidecar, and a split
//     that disagreed with them would be the very divergence BUG-008 was. What
//     survives of "run 3 must not become run C" is the case with no names at
//     all: no level table AND no covering sidecar keeps numeric labels, and
//     that negative control is the load-bearing test.
// Both return the SAME `SplitGroup[]` shape (`SplitResult`) so the dialog
// and the store action never need to know which strategy produced a group.
//
// Column addressing follows `ColumnFilter.col`'s existing convention
// (lib/types.ts): -1 = the x/time column, 0.. = a value channel.
//
// `pickDefaultSplitColumn` (the dialog's initial-column suggestion) lives in
// the sibling `lib/datasetsplitDefault.ts` (2026-08-23, C2 bundle pass) — it
// is the one export here with no consumer in `store/split.ts`'s eager
// `splitColumn`/`tooManyGroups`/`sliceDataStruct` chain, only the (lazy)
// SplitDatasetDialog picking a suggestion.

import { categoryLevels, resolveCategoryLabelsOrNull } from "./barlayout";
import { fmtNum } from "./format";
import { sliceRowSidecars } from "./rowSidecars";
import { channelModelingType, isCategorical } from "./modeling";
import type { DataStruct, Dataset } from "./types";

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
  // levels-allowlist: these are NOT category levels. This is the distinct
  // values of a CONTINUOUS column, taken to measure the GAPS between them for
  // elbow detection — sample points on a measurement axis. A user-settable
  // level order (JMP_GAP J1) must never reach them, so this deliberately does
  // not go through lib/categorical.ts's accessor despite the identical shape.
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
 *  "(other)" group, the same convention `clusterByGaps` uses.
 *
 *  `labelFor` (BUG-008) resolves one level's NAME, or returns null/"" when
 *  that level has none — `splitColumn` builds it from the app's canonical
 *  category-label resolver. `unit` is dropped for a named level (a level name
 *  takes no physical unit) and applied whenever `labelFor` declines, which
 *  keeps such a value visible as the number it is instead of inventing a name
 *  for it. An EMPTY name counts as declining (`||`, not `??`): a hand-edited
 *  `.dwk` can carry `cat_levels: {0: ["", "B"]}`, and a child dataset called
 *  "run.dat ()" is worse than one called "run.dat (0)".
 *
 *  MEASURED CAVEAT on that unit rule, which corrected an earlier version of
 *  this comment: declining is a WHOLE-COLUMN decision in practice, because the
 *  canonical resolver, once it decides a column has names, supplies formatted
 *  numbers of its own for any code its table does not cover
 *  (`lib/barlayout.ts`'s `catTableLabels`). So an out-of-range code on a
 *  `cat_levels` column is labelled "5", not "5 K" — deliberately the same text
 *  a categorical axis tick shows for that code. The unit appears when the
 *  resolver declines for the entire column: no level table and no
 *  consistently-covering text sidecar.
 *
 *  Passing no `labelFor` keeps numeric labels throughout, which is CORRECT for
 *  a small-integer numeric column routed here by the shape heuristic: that
 *  column's values ARE numbers, and "run 3" must not become "run C". */
export function groupByExactValue(
  values: readonly number[],
  unit = "",
  labelFor?: ((value: number) => string | null) | null,
): SplitResult {
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
    label: (labelFor?.(v) || null) ?? formatGroupLabel(v, unit),
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
 *  today (lib/modeling.ts only infers types for value channels).
 *
 *  Takes a `Dataset`, not a bare `DataStruct` (BUG-008): the answer depends
 *  on the dataset-level `channelTypes` override and on `data.cat_levels`,
 *  neither of which the raw `inferModelingType` heuristic can see. All three
 *  consumers of this decision hold a full `Dataset` — `SplitDatasetDialog`,
 *  `store/split.ts`, and `lib/datasetsplitDefault.ts` (whose only caller is
 *  that same dialog) — so there is no DataStruct-only fallback and no
 *  call site where the override silently goes unhonoured. */
export function isCategoricalColumn(ds: Dataset, col: number): boolean {
  if (col < 0) return false;
  return isCategorical(channelModelingType(ds, col));
}

type LabelLookup = ((value: number) => string | null) | null;

/** Resolved label lookups per `(DataStruct, channel)` — round-2 review,
 *  MEDIUM 2. Resolving names is not the O(1) dict read the first cut used:
 *  `categoryLevels` scans the column and builds a Set, and `textLabelsFor`
 *  scans it again plus every candidate text sidecar column. Measured at
 *  100k rows x 20 nominal channels, that took a dialog open from ~220 ms to
 *  ~445 ms, and to ~984 ms against an all-blank sidecar (which
 *  `io/sqlite_query.py` does emit, and which `textLabelsFor` scans in full
 *  before failing its coverage check).
 *
 *  Keyed on the DATASTRUCT object, deliberately tighter than
 *  `lib/modeling.ts`'s cache, which keys on `data.values`: that one only reads
 *  values, while this resolution also depends on `metadata` (the text sidecar)
 *  and `cat_levels`, either of which can change while `values` keeps its
 *  reference. Every store path replaces the DataStruct wholesale
 *  (`{...d, data: {...d.data, ...}}`), so the object identity moves whenever
 *  ANY of the three does. A WeakMap lets a replaced dataset's entry be
 *  collected rather than leaking. */
const labelLookupCache = new WeakMap<DataStruct, Map<number, LabelLookup>>();

/** A per-level name lookup for `col`, or null when the column has no named
 *  levels at all (BUG-008 review). Delegates to `lib/barlayout.ts`'s
 *  `resolveCategoryLabelsOrNull` — the app's ONE category-label resolver,
 *  shared with the bar/box axis, Tabulate, Data Filter, the stat stage,
 *  facets and `lib/byPartition.ts` — so a split's group names can never
 *  disagree with the names those surfaces show for the same column. The
 *  resolver works positionally over an ascending level list, so this pairs it
 *  back up into a value→name map; `categoryLevels` de-duplicates through a
 *  `Set`, which merges `-0` with `0` exactly as `groupByExactValue`'s own
 *  `Map` keying does, so the two agree on what counts as one level. */
function categoryLabelFor(data: DataStruct, col: number): LabelLookup {
  let byChannel = labelLookupCache.get(data);
  if (!byChannel) {
    byChannel = new Map();
    labelLookupCache.set(data, byChannel);
  }
  const hit = byChannel.get(col);
  if (hit !== undefined) return hit;
  const levels = categoryLevels(data, col);
  const named = resolveCategoryLabelsOrNull(data, col, levels);
  const byValue = named ? new Map(levels.map((lvl, i) => [lvl, named[i]] as const)) : null;
  const lookup: LabelLookup = byValue ? (value) => byValue.get(value) ?? null : null;
  byChannel.set(col, lookup);
  return lookup;
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
function splitGroups(ds: Dataset, col: number, tolerance: number | undefined, withLabels: boolean): SplitResult {
  const data = ds.data;
  const values = columnValues(data, col);
  const unit = columnUnit(data, col);
  if (isCategoricalColumn(ds, col)) {
    return groupByExactValue(values, unit, withLabels ? categoryLabelFor(data, col) : null);
  }
  const tol =
    tolerance !== undefined && Number.isFinite(tolerance) && tolerance >= 0
      ? tolerance
      : autoTolerance(values);
  return clusterByGaps(values, tol, unit);
}

export function splitColumn(ds: Dataset, col: number, tolerance?: number): SplitResult {
  return splitGroups(ds, col, tolerance, true);
}

/** How many groups `col` would split into — the same dispatch and the same
 *  grouping as `splitColumn`, with the label resolution SKIPPED (round-2
 *  review, MEDIUM 2). `lib/datasetsplitDefault.ts` scores every channel to
 *  pick the dialog's default column and only ever reads `groups.length`, so it
 *  was paying for names it discarded, once per channel, on every dialog open.
 *  Labels cannot affect the count — grouping is by VALUE — and a test pins the
 *  two entry points to the same number rather than trusting that claim, since
 *  "two code paths, two answers to the same question" is precisely what
 *  BUG-008 was. */
export function splitGroupCount(ds: Dataset, col: number): number {
  return splitGroups(ds, col, undefined, false).groups.length;
}

/** Slice a DataStruct's time+values rows down to `rowIndexes` (any order —
 *  typically ascending, straight from a `SplitGroup`) into a fresh,
 *  non-aliased DataStruct. labels/units/cat_levels are structural (per-COLUMN,
 *  not per-row) so they're copied whole, unaffected by which rows survive -- a
 *  row slice preserves column LAYOUT (P1.4 review P2-2: a categorical child
 *  dataset must stay categorical, since its level table and codes are
 *  untouched by which rows remain) -- this is the "per-row-safe fields" the
 *  store's `splitDatasetByColumn` action builds each child dataset's `data`
 *  from.
 *
 *  METADATA IS NOT WHOLLY STRUCTURAL, which is what BUG-006 was: this copied
 *  `metadata` whole, but the `text_columns` sidecar inside it is indexed BY
 *  ROW. So an Extract or a Split-by-column produced a child whose numeric rows
 *  were the right ones and whose text cells were still the PARENT's full
 *  lists — every sample id, operator and run label silently attributed to a
 *  different measurement than the one it belonged to. Row-indexed sidecars are
 *  now sliced alongside the rows; channel-indexed ones still are not. */
export function sliceDataStruct(data: DataStruct, rowIndexes: readonly number[]): DataStruct {
  return {
    time: rowIndexes.map((i) => data.time[i]),
    values: rowIndexes.map((i) => [...data.values[i]]),
    labels: [...data.labels],
    units: [...data.units],
    metadata: sliceRowSidecars(data.metadata, rowIndexes),
    ...(data.cat_levels ? { cat_levels: data.cat_levels } : {}),
  };
}
