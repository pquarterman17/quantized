// P2.6 "Missing levels and unbalanced groups are explicit"
// (PRIMARY_SOFTWARE_AUDIT_PLAN). The ONE answer to "which category SLOTS does a
// box / violin / strip / bar plot have, how many usable rows landed in each,
// and what happened to the rows that did not?" — shared by the Stat Stage's
// canvas and its vector export, so the two cannot disagree about a slot.
//
// Before this module the slot list was the PARTITION of the analysis view
// (`statschooser.groupsByCategory`): a level with no finite value simply had no
// bucket and vanished — on screen AND in the export. Three different facts all
// disappeared the same silent way:
//   (a) a DECLARED level (a `cat_levels` entry) with no rows at all;
//   (b) a level whose Y is all NaN, or whose rows are all excluded/filtered;
//   (c) a nested (A, B) combination that never occurs.
// A reader could not tell "lot C was never measured" from "lot C is missing
// from this chart". The rule now: every such level is an EMPTY SLOT — it keeps
// its axis position and label and is annotated `n=0` — unless the plot opts
// into `hideEmpty` (persisted on the plot view, `lib/statLevelOptions.ts`).
//
// THE CAP. A nested plot's slot count is the product of both factors' level
// counts, so a 60-level lot x 40-level wafer plot would ask for 2,400 slots,
// nearly all empty. Past `MAX_LEVEL_SLOTS` (200) empty slots are hidden as if
// `hideEmpty` were on, and the notice says how many were hidden and why. The
// cap only ever hides EMPTY slots — a slot with data is never dropped by it —
// and the full cross product is never materialized past the cap (slots are
// created lazily from the rows, and only back-filled when under it).
//
// ROWS (guard #11). Values and their `rowIndex` come from
// `rowstate.analysisData` — exclusion #50 ∪ local filter #53 already pruned —
// so the jitter hash sees the same analysis-view row index it always did. The
// raw rows are read only for what the analysis view no longer HAS: which level
// codes exist (a level whose rows are all excluded must still get its slot) and
// which slot each `rowstate.droppedRows` row would have landed in.
//
// SCOPE. The flat Stat Stage (box/violin/strip/bar) and its export. Faceted
// panels and the Graph Builder's mini-preview still build their groups through
// `statstage.resolveGroups`, which drops empty levels — a recorded residual in
// the plan, not a second rule.

import { resolveCategoryLabels, seriesStat, type BarChartData } from "./barlayout";
import { categoricalLevels, columnOf, levelOrderFor, levelsOf, orderLevels } from "./categorical";
import { analysisData, droppedRows } from "./rowstate";
import { columnDisplayName, NESTED_LABEL_SEP, type IndexedPoint } from "./statschooser";
import type { DataStruct, Dataset } from "./types";

/** Empty slots are hidden once the empty-inclusive layout would exceed this. */
export const MAX_LEVEL_SLOTS = 200;
/** "Very unbalanced": a group smaller than this fraction of the largest. */
export const UNBALANCED_RATIO = 0.2;
/** Below this n, a group's mean/CI/SEM are flagged as unreliable. */
export const LOW_N = 3;
/** The caveat mark on a flagged group's count label (and in the notice). */
export const CAVEAT = "†";

/** One category slot. Structurally an `IndexedGroupSpec` (label + points), so
 *  it feeds the existing box/strip builders unchanged. */
export interface LevelSlot {
  label: string;
  /** Usable rows: finite Y in the analysis view; `rowIndex` is that view's row. */
  points: IndexedPoint[];
  /** Analysis-view rows of this slot whose Y is non-finite. */
  nanY: number;
  /** Rows of this slot dropped by exclusion or the local filter. */
  dropped: number;
}

export interface LevelSlotResult {
  /** The slots to draw, in display order (empty ones included unless hidden). */
  slots: LevelSlot[];
  /** Empty slots removed by `hideEmpty` or the cap. */
  hiddenEmpty: number;
  /** True when the CAP (not the user's option) hid them. */
  capped: boolean;
  /** Every slot that lost at least one row, hidden or not — the per-level
   *  dropped-row accounting. */
  lossy: LevelSlot[];
  /** Rows dropped by exclusion/filter, counted ONCE each (a per-channel slot
   *  list sees the same row once per channel). */
  droppedTotal: number;
  /** Analysis-view rows whose group code is missing (NaN) or not a level — no
   *  slot to land in, so they would otherwise vanish uncounted. */
  noLevel: number;
}

/** A column's levels INCLUDING declared-but-absent ones: the finite codes
 *  present in the column, union every code the level table names, in display
 *  order (`orderLevels` over the user's `level_order`). Reuses `levelsOf` for
 *  the distinct-value walk — the levels chokepoint, not a private copy. */
export function declaredLevels(data: DataStruct, col: number): number[] {
  const declared = (categoricalLevels(data, col) ?? []).map((_, code) => code);
  return orderLevels(levelsOf([...columnOf(data, col), ...declared]), levelOrderFor(data, col));
}

const newSlot = (label: string): LevelSlot => ({ label, points: [], nanY: 0, dropped: 0 });

interface Collected {
  all: LevelSlot[];
  total: number;
  lazy: boolean;
  droppedTotal: number;
  noLevel: number;
}

/** Every slot of one value channel, before the hide/cap decision. `lazy` =
 *  slots were created only from the rows (never back-filled), because the
 *  empty-inclusive layout (`total`) is over the cap and would not be drawn. */
function collectSlots(
  ds: Dataset,
  valueCol: number,
  groupCol: number | null,
  group2Col: number | null,
  plotted: readonly number[],
  bare = false,
): Collected {
  const raw = ds.data;
  const view = analysisData(ds) ?? raw;
  const drop = droppedRows(ds);
  let noLevel = 0;

  if (groupCol == null) {
    const all = (plotted.length ? plotted : [valueCol]).map((c) => {
      const slot = newSlot(columnDisplayName(raw, c));
      columnOf(view, c).forEach((y, r) => {
        if (Number.isFinite(y)) slot.points.push({ value: y, rowIndex: r });
        else slot.nanY++;
      });
      slot.dropped = drop.size;
      return slot;
    });
    return { all, total: all.length, lazy: false, droppedTotal: drop.size, noLevel };
  }

  const aLv = declaredLevels(raw, groupCol);
  const aLab = resolveCategoryLabels(raw, groupCol, aLv).map((t) => (bare ? t : `${columnDisplayName(raw, groupCol)} = ${t}`));
  const bLv = group2Col == null ? [Number.NaN] : declaredLevels(raw, group2Col);
  const bLab =
    group2Col == null
      ? [""]
      : resolveCategoryLabels(raw, group2Col, bLv).map((t) => `${NESTED_LABEL_SEP}${columnDisplayName(raw, group2Col)} = ${t}`);
  const total = aLv.length * bLv.length;
  const lazy = total > MAX_LEVEL_SLOTS;
  const aPos = new Map(aLv.map((c, i) => [c, i]));
  const bPos = new Map(bLv.map((c, i) => [c, i]));
  const byKey = new Map<number, LevelSlot>();
  const ensure = (ai: number, bi: number): LevelSlot => {
    const key = ai * bLv.length + bi;
    let slot = byKey.get(key);
    if (!slot) byKey.set(key, (slot = newSlot(aLab[ai] + bLab[bi])));
    return slot;
  };
  if (!lazy) for (let ai = 0; ai < aLv.length; ai++) for (let bi = 0; bi < bLv.length; bi++) ensure(ai, bi);
  /** The slot row `r` of `data` belongs to, or null when a code is missing. */
  const slotOf = (data: DataStruct, r: number): LevelSlot | null => {
    const ai = aPos.get(data.values[r]?.[groupCol] ?? Number.NaN);
    const bi = group2Col == null ? 0 : bPos.get(data.values[r]?.[group2Col] ?? Number.NaN);
    return ai === undefined || bi === undefined ? null : ensure(ai, bi);
  };
  const ys = columnOf(view, valueCol);
  for (let r = 0; r < ys.length; r++) {
    const slot = slotOf(view, r);
    if (!slot) noLevel++;
    else if (Number.isFinite(ys[r])) slot.points.push({ value: ys[r], rowIndex: r });
    else slot.nanY++;
  }
  for (const r of drop) {
    const slot = slotOf(raw, r);
    if (slot) slot.dropped++;
  }
  const all = [...byKey.entries()].sort((p, q) => p[0] - q[0]).map(([, slot]) => slot);
  return { all, total, lazy, droppedTotal: drop.size, noLevel };
}

const isLossy = (s: LevelSlot): boolean => s.nanY > 0 || s.dropped > 0;

/** Which slot positions to draw. `runs` are one or more slot lists over the
 *  SAME group column (bar mode: one per value channel) — they always hold the
 *  same slots in the same order, because a slot is created from the row's
 *  GROUP code, never from its Y. A position is filled when ANY run has a point
 *  there. */
function keepSlots(runs: readonly LevelSlot[][], total: number, lazy: boolean, hideEmpty: boolean) {
  const all = [...Array(runs[0]?.length ?? 0).keys()];
  const filled = all.filter((i) => runs.some((run) => run[i].points.length > 0));
  const capped = !hideEmpty && lazy && filled.length < total;
  const hide = hideEmpty || capped;
  return { idx: hide ? filled : all, hiddenEmpty: hide ? total - filled.length : 0, capped };
}

/** Build the slot list for a box/violin/strip plot of `valueCol`.
 *
 *  `groupCol === null` is the per-plotted-channel fallback (one slot per
 *  `plotted` channel, or `valueCol` alone); `group2Col` nests a second factor
 *  (the caller passes the already-masked pick). */
export function buildLevelSlots(
  ds: Dataset,
  valueCol: number,
  groupCol: number | null,
  group2Col: number | null,
  plotted: readonly number[],
  hideEmpty: boolean,
): LevelSlotResult {
  const c = collectSlots(ds, valueCol, groupCol, group2Col, plotted);
  const keep = keepSlots([c.all], c.total, c.lazy, hideEmpty);
  return {
    slots: keep.idx.map((i) => c.all[i]),
    hiddenEmpty: keep.hiddenEmpty,
    capped: keep.capped,
    lossy: c.all.filter(isLossy),
    droppedTotal: c.droppedTotal,
    noLevel: c.noLevel,
  };
}

/** `hideEmpty` applied AFTER the fact — a pure view step over a result built
 *  with it off, so toggling the option never changes the filled groups (and so
 *  never re-runs the stats they feed). Past the cap the empties are already
 *  gone; the user's option then makes the cap moot, so `capped` clears. */
export function hideEmptySlots(r: LevelSlotResult, hide: boolean): LevelSlotResult {
  if (!hide) return r;
  const slots = r.slots.filter((s) => s.points.length > 0);
  return { ...r, slots, hiddenEmpty: r.hiddenEmpty + r.slots.length - slots.length, capped: false };
}

/** Bar mode's slots: the category axis of a category x series matrix. One
 *  collection per value channel over the same group column, sharing ONE slot
 *  decision (a category is empty only when every series is), so the bars obey
 *  exactly the box/violin/strip rule — declared levels, NaN/excluded-only
 *  levels, `hideEmpty`, the cap. */
export interface BarLevelSlots extends Omit<LevelSlotResult, "slots"> {
  labels: string[];
  /** `[channel][slot]`, slot-aligned with `labels`. */
  channels: LevelSlot[][];
}

export function buildBarLevelSlots(
  ds: Dataset,
  groupCol: number,
  valueChannels: readonly number[],
  hideEmpty: boolean,
): BarLevelSlots {
  // `bare` labels: a bar category tick is the level text alone ("A", not
  // "lot = A") — bar's long-standing convention (`barlayout.buildBarMatrix`,
  // shared with the Graph Builder and faceted bars), which names the column
  // in the axis caption instead.
  const runs = valueChannels.map((c) => collectSlots(ds, c, groupCol, null, [], true));
  const first = runs[0];
  if (!first) {
    return { labels: [], channels: [], hiddenEmpty: 0, capped: false, lossy: [], droppedTotal: 0, noLevel: 0 };
  }
  const keep = keepSlots(runs.map((r) => r.all), first.total, first.lazy, hideEmpty);
  // The dropped-row tooltip names the column (a bare "A" means nothing there)
  // and, with several series, the series too.
  const named = (s: LevelSlot, k: number): LevelSlot => ({
    ...s,
    label:
      `${columnDisplayName(ds.data, groupCol)} = ${s.label}` +
      (runs.length > 1 ? ` (${columnDisplayName(ds.data, valueChannels[k])})` : ""),
  });
  return {
    labels: keep.idx.map((i) => first.all[i].label),
    channels: runs.map((r) => keep.idx.map((i) => r.all[i])),
    hiddenEmpty: keep.hiddenEmpty,
    capped: keep.capped,
    lossy: runs.flatMap((r, k) => r.all.filter(isLossy).map((s) => named(s, k))),
    droppedTotal: first.droppedTotal,
    noLevel: first.noLevel,
  };
}

/** The bar matrix a `BarLevelSlots` draws: mean +/- SEM per (category,
 *  series), exactly `barlayout.seriesStat` — an empty cell is `n: 0`. */
export function barChartFromSlots(b: BarLevelSlots, seriesLabels: readonly string[]): BarChartData {
  return {
    groups: b.labels.map((label, i) => ({
      label,
      series: b.channels.map((run) => seriesStat(run[i].points.map((p) => p.value))),
    })),
    seriesLabels: [...seriesLabels],
  };
}

/** The n behind each bar-mode count label: one per bar when grouped, and ONE
 *  PER CATEGORY when stacked — the category's TOTAL n, i.e. how many rows of
 *  that category have a finite value in at least one stacked series.
 *
 *  Why the total and not a segment's n (PR #433 review): a stacked bar is one
 *  visible glyph per category, so its label must describe the whole bar. The
 *  earlier top-segment n printed "n=0" over a visible bar whenever only the
 *  lower series had rows, and let a small top series dagger a large category.
 *  The caveat (and the unbalanced notice) is therefore computed on the totals
 *  too — the per-segment SEM on the top segment is a drawing convention, not a
 *  sample the reader is comparing across categories.
 *
 *  `slots` (a picked group column) supplies the row identities; without it
 *  (the per-plotted-channel fallback) every category holds a single series, so
 *  its n IS the category's n. */
export function barCounts(data: BarChartData, stacked: boolean, slots: BarLevelSlots | null = null): number[] {
  if (!stacked) return data.groups.flatMap((g) => g.series.map((s) => s.n));
  if (!slots) return data.groups.map((g) => g.series.reduce((m, s) => Math.max(m, s.n), 0));
  return slots.labels.map((_, i) => new Set(slots.channels.flatMap((run) => run[i].points.map((p) => p.rowIndex))).size);
}

// ── Count labels, caveat and the one-line notice ────────────────────────────

const maxOf = (counts: readonly number[]): number => counts.reduce((m, c) => (c > m ? c : m), 0);

/** A group whose summary stats carry the caveat: n below `LOW_N`, or below
 *  `UNBALANCED_RATIO` of the largest group. Empty groups are not "caveated" —
 *  they have no stats at all, and say so with `n=0`. */
export function isCaveated(n: number, maxN: number): boolean {
  return n > 0 && (n < LOW_N || n / maxN < UNBALANCED_RATIO);
}

/** Per-slot count annotation, the SINGLE author of that text for the canvas and
 *  the export (`count_labels` on the wire). `n=0` on an empty slot and the
 *  caveat mark on a flagged group are ALWAYS shown; the plain `n=K` on an
 *  ordinary group follows the user's `showN` option. `null` = no label. */
export function countLabels(counts: readonly number[], showN: boolean): (string | null)[] {
  const max = maxOf(counts);
  return counts.map((c) =>
    c === 0 ? "n=0" : isCaveated(c, max) ? `n=${c}${CAVEAT}` : showN ? `n=${c}` : null,
  );
}

/** The one-line diagnostics notice (also the export's footnote): fires when
 *  the groups are very unbalanced (min/max n < `UNBALANCED_RATIO`) or any
 *  group has n < `LOW_N`, and when the cap hid empty slots. `null` = nothing
 *  worth saying. */
export function levelNotice(counts: readonly number[], hiddenEmpty = 0, capped = false): string | null {
  const filled = counts.filter((c) => c > 0);
  const parts: string[] = [];
  if (filled.length > 0) {
    const max = maxOf(filled);
    const min = filled.reduce((m, c) => (c < m ? c : m), max);
    const low = filled.filter((c) => c < LOW_N).length;
    const ratio = min / max;
    // FLOORED to the printed precision: rounding would print 0.199 as "0.20 <
    // 0.2", a false inequality in a figure footnote.
    const shown = (Math.floor(ratio * 100) / 100).toFixed(2);
    const why = [
      ratio < UNBALANCED_RATIO ? `min/max n = ${shown} < ${UNBALANCED_RATIO}` : null,
      low > 0 ? `${low} group${low === 1 ? "" : "s"} with n < ${LOW_N}` : null,
    ].filter((w): w is string => w !== null);
    if (why.length > 0) {
      // "Unbalanced" only when the ratio rule fired; a lone n=2 group, or
      // several equally tiny ones, are small, not unbalanced (PR #433 nit).
      const head = ratio < UNBALANCED_RATIO ? "Unbalanced groups" : "Small groups";
      parts.push(
        `${CAVEAT} ${head} (n = ${min} to ${max}; ${why.join("; ")}): ` +
          `summary stats and error bars on ${CAVEAT} groups are unreliable`,
      );
    }
  }
  if (capped) parts.push(`${hiddenEmpty} empty level slots hidden (over the ${MAX_LEVEL_SLOTS}-slot cap)`);
  return parts.length > 0 ? parts.join(". ") : null;
}

const plural = (k: number, one: string, many: string): string | null =>
  k > 0 ? `${k} ${k === 1 ? one : many}` : null;

/** Dropped-row accounting for the diagnostics line: a short summary plus a
 *  per-level breakdown (the line's tooltip). Excluded/filtered rows are counted
 *  once each (`droppedTotal`), non-finite Y per plotted VALUE (a per-channel
 *  plot can lose one row's Y in one channel only), and rows with no level
 *  separately. `null` when nothing was lost. */
export function droppedSummary(
  r: Pick<LevelSlotResult, "lossy" | "droppedTotal" | "noLevel">,
): { text: string; detail: string } | null {
  const nan = r.lossy.reduce((k, s) => k + s.nanY, 0);
  const parts = [
    plural(r.droppedTotal, "excluded/filtered row", "excluded/filtered rows"),
    plural(nan, "non-finite Y value", "non-finite Y values"),
    plural(r.noLevel, "row with no level", "rows with no level"),
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  const cell = (s: LevelSlot): string =>
    [plural(s.nanY, "non-finite Y", "non-finite Y"), plural(s.dropped, "excluded/filtered", "excluded/filtered")]
      .filter((p) => p !== null)
      .join(", ");
  return {
    text: `Dropped: ${parts.join(", ")}`,
    detail: r.lossy.map((s) => `${s.label}: ${cell(s)}`).join("\n"),
  };
}
