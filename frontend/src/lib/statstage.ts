// Pure math for the interactive statistical-plot stage (gap #16): grouping,
// a client-side box-stats fallback (matches calc.statplots.box_stats exactly
// — same linear-interpolation quartiles + Tukey whisker rule — so the offline
// path renders the same whiskers/fliers the backend would), and the scale /
// layout math the Canvas2D stage (statRender.ts) paints from. No React /
// store / fetch here — useStatStage.ts is the only caller that touches live
// data; everything below is plain arrays in, plain numbers out, so every
// branch unit-tests standalone (lib/polar.ts is the precedent).

import { channelModelingType, isCategorical } from "./modeling";
import { groupsByCategory, groupsFromColumns, type GroupSpec } from "./statschooser";
import type { DataStruct, Dataset } from "./types";

export type StatMode = "box" | "violin" | "qq" | "histogram" | "bar";

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
 *  selects the fallback explicitly. */
export function resolveGroups(
  data: DataStruct,
  groupCol: number | null,
  valueCol: number,
  plotted: readonly number[],
): GroupSpec[] {
  if (groupCol != null) return groupsByCategory(data, valueCol, groupCol);
  const cols = plotted.length ? plotted : [valueCol];
  return groupsFromColumns(data, cols);
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
  return { label, q1, median, q3, iqr, whislo, whishi, mean, n: v.length, fliers };
}

/** `boxStatsClient` for each group — the Box-mode offline payload. */
export function groupBoxStatsClient(
  groups: readonly GroupSpec[],
  whis: number | "range" = 1.5,
): BoxStat[] {
  return groups.map((g) => boxStatsClient(g.values, whis, g.label));
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
