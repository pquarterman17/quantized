// Pure math for the interactive statistical-plot stage (gap #16): grouping,
// a client-side box-stats fallback (matches calc.statplots.box_stats exactly
// — same linear-interpolation quartiles + Tukey whisker rule — so the offline
// path renders the same whiskers/fliers the backend would), and the scale /
// layout math the Canvas2D stage (statRender.ts) paints from. No React /
// store / fetch here — useStatStage.ts is the only caller that touches live
// data; everything below is plain arrays in, plain numbers out, so every
// branch unit-tests standalone (lib/polar.ts is the precedent).

import { channelModelingType, isCategorical } from "./modeling";
import {
  groupsByCategory,
  groupsByCategoryIndexed,
  groupsByNestedCategory,
  groupsByNestedCategoryIndexed,
  groupsFromColumns,
  groupsFromColumnsIndexed,
  type GroupSpec,
  type IndexedGroupSpec,
} from "./statschooser";
import { tCritical95 } from "./tdist";
import type { DataStruct, Dataset } from "./types";

export type { IndexedGroupSpec, IndexedPoint } from "./statschooser";

// "strip" (JMP_GAP J5 #3): a points-only categorical plot -- same category
// slots as box, but no quartile/whisker glyph, just the jittered points
// (always on) with an optional mean+-CI marker.
export type StatMode = "box" | "violin" | "qq" | "histogram" | "bar" | "strip";

// ── Column selection ────────────────────────────────────────────────────────

/** Channel indices (0..) that read as categorical (few discrete levels) — the
 *  candidates for a Box/Violin "group by" column. Never the shared x/time
 *  column: a category needs its own labeled column. */
export function categoricalChannels(ds: Dataset | null): number[] {
  if (!ds) return [];
  const out: number[] = [];
  for (let i = 0; i < ds.data.labels.length; i++) {
    if (isCategorical(channelModelingType(ds, i))) out.push(i);
  }
  return out;
}

/** BUG-004 (BUGS_AND_ISSUES.md): mask Stat Stage's picked categorical
 *  columns (`groupCol`/`facetCol`) back to `null` once either no longer
 *  reads as categorical — a `channelTypes` override changed after the pick
 *  was made,
 *  and nothing else clears the stored pick (same root cause as BUG-003's
 *  Data Filter finding: a stored selection outliving its column's
 *  classification). `categoricalIndex` recomputes fresh every render
 *  (`categoricalChannels` above), so a stale pick simply falls out of it;
 *  without this mask, the "group by"/"facet by" `<select>` would show a
 *  `value` naming no `<option>` in its own list (the same visible symptom
 *  BUG-003 named) while the chart underneath kept partitioning by the now-
 *  uncategorized column regardless. Unlike Data Filter's row-filtering
 *  (`lib/datafilter.ts`, shared app-wide by Tabulate/Distribution/every
 *  `analysisData` consumer, so BUG-003 left that side an open owner call),
 *  `groupCol`/`facetCol` have exactly ONE consumer — `useStatStage.ts` —
 *  so there's no wider blast radius to defer: callers apply this mask to
 *  BOTH the exposed picker value and the actual grouping/faceting math, so
 *  the toolbar and the rendered chart can never disagree about which
 *  column drives the split. The caller's RAW picks are untouched by this
 *  function (only read through it), so reverting the override brings the
 *  exact same pick back automatically. */
export interface EffectiveCategoricalPicks {
  groupCol: number | null;
  /** The NESTED second factor (Group R) — non-null only when it is itself
   *  live, DISTINCT from `groupCol`, and `groupCol` is set. See below. */
  group2Col: number | null;
  facetCol: number | null;
}

/** Applies the mask above to Stat Stage's categorical picks at once,
 *  building the lookup Set internally so the caller doesn't need its own
 *  `useMemo` for it. */
export function maskStaleCategoricalPicks(
  groupCol: number | null,
  facetCol: number | null,
  categoricalCols: readonly { index: number }[],
  group2Col: number | null = null,
): EffectiveCategoricalPicks {
  const index = new Set(categoricalCols.map((c) => c.index));
  const liveGroup = groupCol != null && index.has(groupCol) ? groupCol : null;
  return {
    // groupCol is masked: EVERY way to set it is categorical-gated — the
    // picker's own option list, and `useGraphBuilder`'s seed, which computes
    // `x && isCategorical(channelModelingType(ds, x.channel)) ? x.channel :
    // null`. So a non-categorical groupCol can only be a stale leftover.
    groupCol: liveGroup,
    // group2Col (Group R, the NESTED second factor) is masked exactly like
    // groupCol — its only entry point is a picker built from the same
    // `categoricalCols` list, and the Graph Builder seed clears it outright
    // (it has no nested spec to send), so a non-categorical value can only be
    // a stale leftover. It carries TWO further conditions that groupCol does
    // not, both of which would otherwise render a nonsense axis:
    //
    //   * `liveGroup == null` -> inactive. Without a first factor there is
    //     nothing to nest INSIDE; the grouping falls back to one group per
    //     plotted channel, which is not a factor at all.
    //   * equal to the first factor -> inactive. `groupsByNestedCategory(d,
    //     v, 1, 1)` is well-defined but labels every box `lot = 0 / lot = 0`.
    //     The picker already omits the chosen column, but `groupCol` can MOVE
    //     onto `group2Col` afterwards, so the rule belongs here, not there.
    group2Col:
      liveGroup != null && group2Col != null && group2Col !== liveGroup && index.has(group2Col)
        ? group2Col
        : null,
    // facetCol is NOT masked. REVIEW ROUND — masking it was a regression I
    // introduced. `useGraphBuilder` seeds `facetCol` from
    // `spec.zones.facet?.channel` with NO categorical gate (unlike groupCol
    // right above it), and `facetSlices` has no categorical gate either, so
    // faceting on a non-categorical column is a SUPPORTED configuration that
    // Graph Builder deliberately produces and announces ("faceted by <label>").
    // Masking it turned a working faceted plot into one unfaceted panel while
    // the status line still claimed it was faceted.
    //
    // The asymmetry is the point: a pick is only "stale" if no live entry point
    // could have produced it. That is true of groupCol and false of facetCol.
    facetCol,
  };
}

/** First continuous channel other than `avoid`, else the first channel other
 *  than `avoid`, else 0 — mirrors the Tabulate workshop's default picker
 *  (useTabulate.firstContinuous). */
export function firstValueChannel(ds: Dataset | null, avoid: number): number {
  if (!ds) return 0;
  const n = ds.data.labels.length;
  for (let i = 0; i < n; i++) {
    if (i !== avoid && !isCategorical(channelModelingType(ds, i))) return i;
  }
  for (let i = 0; i < n; i++) if (i !== avoid) return i;
  return 0;
}

// ── Grouping (Box / Violin) ─────────────────────────────────────────────────

/** Groups for Box/Violin: partition `valueCol` by `groupCol` when a
 *  categorical column is picked; otherwise one group per PLOTTED channel —
 *  the whole-dataset fallback for datasets with no categorical column
 *  (mirrors polar/stack's "just use what's plotted"). `groupCol === null`
 *  selects the fallback explicitly.
 *
 *  `group2Col` (Group R) nests a SECOND factor inside the first: one box per
 *  (A, B) cell that has finite values, in nested display order. It is the
 *  trailing OPTIONAL parameter because two of the four call sites are
 *  deliberately single-factor and must stay that way —
 *  `useStatStageCompute.computeBoxDraw`'s per-channel fallback (`groupCol`
 *  null, so nesting is meaningless by definition) and `lib/plotspec.ts`'s
 *  Graph Builder path, whose spec has one category zone and therefore no
 *  second factor to pass. The Stat Stage's own two call sites (the flat draw
 *  and `computeFacetGroupDraws`) BOTH pass it; a facet that silently dropped
 *  the nesting the flat panel shows would be the obvious defect here.
 *
 *  Callers pass the MASKED pick (`maskStaleCategoricalPicks(...).group2Col`),
 *  which is already null whenever `groupCol` is null or the two factors are
 *  the same column — so the `groupCol != null` branch below is the only place
 *  nesting can engage. */
export function resolveGroups(
  data: DataStruct,
  groupCol: number | null,
  valueCol: number,
  plotted: readonly number[],
  group2Col: number | null = null,
): GroupSpec[] {
  if (groupCol != null) {
    return group2Col != null && group2Col !== groupCol
      ? groupsByNestedCategory(data, valueCol, groupCol, group2Col)
      : groupsByCategory(data, valueCol, groupCol);
  }
  const cols = plotted.length ? plotted : [valueCol];
  return groupsFromColumns(data, cols);
}

/** Index-preserving counterpart to `resolveGroups` -- Box's "show points"
 *  overlay and Strip mode (JMP_GAP J5 #1/#3) both need each point's
 *  ORIGINAL dataset row index (for the deterministic jitter hash), not just
 *  its value. Mirrors `resolveGroups`' own branch logic exactly (same
 *  partition, same fallback, same order), so a group's points line up 1:1
 *  with its `BoxStat` sibling from `resolveGroups`/`groupBoxStatsClient`. */
export function resolveGroupsIndexed(
  data: DataStruct,
  groupCol: number | null,
  valueCol: number,
  plotted: readonly number[],
  group2Col: number | null = null,
): IndexedGroupSpec[] {
  if (groupCol != null) {
    return group2Col != null && group2Col !== groupCol
      ? groupsByNestedCategoryIndexed(data, valueCol, groupCol, group2Col)
      : groupsByCategoryIndexed(data, valueCol, groupCol);
  }
  const cols = plotted.length ? plotted : [valueCol];
  return groupsFromColumnsIndexed(data, cols);
}

// ── Client-side box stats (offline fallback) ────────────────────────────────

export interface BoxStat {
  label: string;
  q1: number;
  median: number;
  q3: number;
  iqr: number;
  whislo: number;
  whishi: number;
  mean: number;
  /** Standard error of the mean (ddof=1). NaN when n<2 (no defined spread) --
   *  matches `calc.statplots.box_stats`'s same edge case. Optional only for
   *  wire back-compat with a payload that predates JMP_GAP J5 #2; the client
   *  fallback (`boxStatsClient`) always sets it. */
  sem?: number;
  /** Mean +/- 95% t-based CI bounds (JMP_GAP J5 #2): `mean -/+
   *  t(0.975, n-1)*sem`. Equal to `mean` when n<2. */
  ciLo?: number;
  ciHi?: number;
  n: number;
  fliers: number[];
}

/** numpy's default ('linear') percentile interpolation over an ASCENDING
 *  sorted array — the rule `numpy.percentile` (and matplotlib's boxplot,
 *  hence `calc.statplots.box_stats`) use. */
function percentileLinear(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const rank = (p / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;
  return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
}

/** Box-and-whisker stats for one sample, matching
 *  `calc.statplots.box_stats` / `matplotlib.cbook.boxplot_stats`:
 *  linear-interpolation quartiles + Tukey `whis`*IQR whiskers (or
 *  `"range"` for min/max whiskers, no fliers). The offline fallback so Box
 *  mode still renders without the backend — Violin's KDE has no such
 *  fallback and degrades to this instead (never fakes a density). */
export function boxStatsClient(
  values: readonly number[],
  whis: number | "range" = 1.5,
  label = "",
): BoxStat {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length === 0) throw new Error("boxStatsClient needs at least one finite value");
  const sorted = [...v].sort((a, b) => a - b);
  const q1 = percentileLinear(sorted, 25);
  const median = percentileLinear(sorted, 50);
  const q3 = percentileLinear(sorted, 75);
  const iqr = q3 - q1;
  let whislo: number;
  let whishi: number;
  if (whis === "range") {
    whislo = sorted[0];
    whishi = sorted[sorted.length - 1];
  } else {
    const loFence = q1 - whis * iqr;
    const hiFence = q3 + whis * iqr;
    const below = sorted.filter((x) => x >= loFence);
    const above = sorted.filter((x) => x <= hiFence);
    whislo = below.length ? below[0] : q1;
    whishi = above.length ? above[above.length - 1] : q3;
  }
  const fliers = sorted.filter((x) => x < whislo || x > whishi);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  // Mean +/- 95% CI (JMP_GAP J5 #2): mirrors calc.statplots.box_stats's sem/
  // ci_lo/ci_hi exactly (ddof=1 sample std, t(0.975, n-1) critical value) so
  // the offline fallback shows the SAME marker the backend would.
  let sem = NaN;
  let ciLo = mean;
  let ciHi = mean;
  if (v.length >= 2) {
    const variance = v.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (v.length - 1);
    sem = Math.sqrt(variance) / Math.sqrt(v.length);
    const tCrit = tCritical95(v.length - 1);
    ciLo = mean - tCrit * sem;
    ciHi = mean + tCrit * sem;
  }
  return { label, q1, median, q3, iqr, whislo, whishi, mean, sem, ciLo, ciHi, n: v.length, fliers };
}

/** `boxStatsClient` for each group — the Box-mode offline payload. */
export function groupBoxStatsClient(
  groups: readonly GroupSpec[],
  whis: number | "range" = 1.5,
): BoxStat[] {
  return groups.map((g) => boxStatsClient(g.values, whis, g.label));
}

/** Connect-group-means "interaction plot" line (JMP_GAP J5 residual): the
 *  mean of each box/strip category slot, in on-screen axis order — a pure
 *  passthrough over `BoxStat.mean` (the SAME number the mean+-CI marker
 *  already reads, never a second/independent computation). `NaN` entries
 *  (a group whose mean somehow isn't finite) are left in place; the
 *  renderer breaks the polyline there rather than drawing through a gap. */
export function connectMeansSeries(boxes: readonly BoxStat[]): number[] {
  return boxes.map((b) => b.mean);
}

// ── Scale / layout math (Canvas2D) ──────────────────────────────────────────

/** A padded finite domain spanning every value in `lists` — never degenerate
 *  (a single repeated value still gets a visible span). `[0, 1]` when
 *  nothing finite is present (empty-data guard). */
export function finiteDomain(
  lists: readonly (readonly number[])[],
  padFrac = 0.08,
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const vs of lists) {
    for (const v of vs) {
      if (Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (hi === lo) {
    const pad = Math.abs(lo) * 0.1 || 1;
    return [lo - pad, hi + pad];
  }
  const pad = (hi - lo) * padFrac;
  return [lo - pad, hi + pad];
}

/** A zero-based domain for bar/count axes (histogram): `[0, max*(1+padFrac)]`,
 *  never degenerate. */
export function zeroBasedDomain(
  lists: readonly (readonly number[])[],
  padFrac = 0.08,
): [number, number] {
  let hi = 0;
  for (const vs of lists) for (const v of vs) if (Number.isFinite(v) && v > hi) hi = v;
  return hi > 0 ? [0, hi * (1 + padFrac)] : [0, 1];
}

/** A domain for a bar-chart value axis: ALWAYS includes 0 (bars grow from a
 *  zero baseline, whether the values are positive, negative, or mixed) — the
 *  signed counterpart of `zeroBasedDomain`, which only ever spans [0, max].
 *  Each side is padded independently by `padFrac` of ITS OWN magnitude (so an
 *  all-positive input keeps 0 fixed at the bottom exactly like
 *  `zeroBasedDomain`, an all-negative input keeps 0 fixed at the top, and a
 *  mixed-sign input pads both sides proportionally). `[0, 1]` when every
 *  candidate is non-finite or exactly zero (empty-data guard). */
export function barValueDomain(values: readonly number[], padFrac = 0.08): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === 0 && hi === 0) return [0, 1];
  const loPad = lo < 0 ? -lo * padFrac : 0;
  const hiPad = hi > 0 ? hi * padFrac : 0;
  return [lo - loPad, hi + hiPad];
}

export interface CategorySlot {
  /** Slot centre, as a fraction of the category axis [0,1]. */
  cx: number;
  /** Box/violin half-width, as a fraction of the category axis. */
  halfWidth: number;
}

/** Evenly spaced category slots across [0,1] (one per group), each with a
 *  shared box/violin half-width so neighboring boxes never touch (`widthFrac`
 *  of the per-slot span). */
export function categorySlots(n: number, widthFrac = 0.6): CategorySlot[] {
  if (n <= 0) return [];
  const half = widthFrac / n / 2;
  return Array.from({ length: n }, (_, i) => ({ cx: (i + 0.5) / n, halfWidth: half }));
}

export interface ViolinPoint {
  value: number;
  /** Half-width as a fraction of the slot's max half-width, in [0,1] — the
   *  KDE's own peak maps to 1. */
  halfWidth: number;
}

/** Normalize a KDE density curve to a violin outline shape (pure, so it is
 *  testable without a canvas). */
export function violinOutline(
  xGrid: readonly number[],
  density: readonly number[],
): ViolinPoint[] {
  let dmax = 0;
  for (const d of density) if (Number.isFinite(d) && d > dmax) dmax = d;
  if (dmax <= 0) return xGrid.map((value) => ({ value, halfWidth: 0 }));
  return xGrid.map((value, i) => ({
    value,
    halfWidth: Math.max(0, (density[i] ?? 0) / dmax),
  }));
}
