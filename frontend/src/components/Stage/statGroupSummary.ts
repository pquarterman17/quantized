// Per-group summary table for the categorical statistics stage, and its link
// to the app's row selection (PRIMARY_SOFTWARE_AUDIT_PLAN P2.6 box 4,
// "summary table links to selected groups"). Pure — no React, no store.
//
// WHAT "LINKED" MEANS HERE, concretely (the JMP behaviour):
//   * Picking a group row in the table SELECTS that group's rows in the app's
//     ONE row selection (`store/rowState.selection`, original dataset row
//     indices) — the same selection the Worksheet greys, the XY plot
//     highlights and "Exclude / Keep only selected" act on. No parallel
//     selection model exists for this.
//   * Clicking a category slot on the plot does exactly the same thing.
//   * The other way round, whatever selects rows (the worksheet, an XY brush,
//     a Distribution bin brush, this table) shows up here: every table row
//     reports how many of its rows are selected, a fully-selected group reads
//     `aria-selected`, and the plot bands the slot and rings the points.
//
// WHICH ROWS "A GROUP" IS: the rows behind its box — kept in the analysis view
// (not excluded, not filtered out) with a usable value — collected by the very
// walk that counts the axis's `n` (`LevelAxes.flatRows`). So selecting a group
// never selects an excluded / filtered / non-finite row the plot does not
// show, and the table's `n` is the plot's `n` by construction.
//
// EMPTY LEVELS (an explicit n=0 slot): selectable, and selecting one selects
// NOTHING (the row selection is cleared on a plain pick). Its selected state
// lives in a local "pick" that is only honoured while the row selection is
// the exact object that pick produced — anything else selecting rows drops it
// (`isPickLive`), so an empty row can never look selected against a selection
// it did not make.
//
// KEYS, NOT POSITIONS OR LABELS: every row carries its axis slot's `key`
// (`groupAxis.AxisPlan.keys`: a code, `a|b` for a nested cell, `ch:<col>` for
// the per-channel fallback). Hiding empty levels, a facet panel's own visible
// slots and two codes that happen to share a label all leave it intact.

import { columnOf } from "../../lib/categorical";
import { columnDisplayName } from "../../lib/statschooser";
import type { Dataset } from "../../lib/types";
import type { AxisSlot } from "../../lib/groupAxis";
import type { SlotMark, StatSelectionMarks } from "./statRenderSelection";
import type { LevelAxes } from "./statStageLevels";

/** A facet panel's ORIGINAL rows for one flat slot key (`LevelAxes.
 *  panelRows.get(panel)`), or the whole-plot `row.rows` when not scoped. */
export type PanelScope = ReadonlyMap<string, readonly number[]>;

export interface SummaryStats {
  mean: number;
  sd: number;
  median: number;
  min: number;
  max: number;
}

export interface SummaryRow {
  key: string;
  label: string;
  /** ORIGINAL dataset rows behind this slot's glyph, ascending. */
  rows: readonly number[];
  n: number;
  /** Rows at this level dropped for a non-finite value / by exclusion or
   *  the Data Filter — shown, never selected. */
  nonFinite: number;
  excluded: number;
  absent: boolean;
  /** One per `GroupSummary.valueLabels` entry, or `[]` when `buildGroupSummary`
   *  was asked to skip them (the table is closed — P2.6 review finding 6):
   *  the plot link only ever reads `.rows`/`.key`/`.n`, never this. */
  stats: SummaryStats[];
}

export interface GroupSummary {
  datasetId: string;
  /** Every axis slot, in axis order (empty levels included). */
  rows: SummaryRow[];
  /** The value column each `stats` entry describes ("value" for the
   *  per-channel fallback, where every row IS a channel). */
  valueLabels: string[];
}

const NAN_STATS: SummaryStats = { mean: NaN, sd: NaN, median: NaN, min: NaN, max: NaN };

/** Mean, sample SD (n - 1), median, min and max of the finite `xs`. */
export function describe(xs: readonly number[]): SummaryStats {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  const n = v.length;
  if (!n) return NAN_STATS;
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : NaN;
  const median = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  return { mean, sd, median, min: v[0], max: v[n - 1] };
}

/** The table for `axes` (the stage's whole-plot axis) over `active`.
 *  `computeStats` (default true) gates the mean/SD/median/min/max pass — the
 *  plot link (`selectionMarks`/`applyGesture`/`decorate*`) only ever reads
 *  `.rows`/`.key`/`.n`/`.label`, so a caller whose table is closed can skip
 *  the sort-and-reduce per group entirely (P2.6 review finding 6). */
export function buildGroupSummary(active: Dataset, axes: LevelAxes, computeStats = true): GroupSummary {
  const data = active.data;
  const perChannel = axes.flat.slots.every((s) => s.key?.startsWith("ch:"));
  const statCols = perChannel ? [null] : [...axes.valueCols];
  const cols = new Map<number, readonly number[]>();
  const col = (c: number) => cols.get(c) ?? cols.set(c, columnOf(data, c)).get(c) ?? [];
  const rows = axes.flat.slots.map((s: AxisSlot, i): SummaryRow => {
    const behind = axes.flatRows[i] ?? [];
    const key = s.key ?? `slot:${i}`;
    // The per-channel fallback's column for slot i is `fallbackCols[i]`
    // (review finding 8) — `axes.fallbackCols` is already index-aligned with
    // `axes.flat.slots`, so this never re-parses the `ch:<col>` key text.
    const stats = computeStats
      ? statCols.map((c) => describe(behind.map((r) => col(c ?? axes.fallbackCols[i])[r])))
      : [];
    return {
      key, label: s.label, rows: behind, n: s.n, nonFinite: s.nonFinite, excluded: s.excluded, absent: s.absent, stats,
    };
  });
  const valueLabels = statCols.map((c) => (c == null ? "value" : columnDisplayName(data, c)));
  return { datasetId: active.id, rows, valueLabels };
}

/** The rows the table lists — the plot's slots: every one, or only the
 *  filled ones when empty levels are hidden (`groupAxis.visibleSlots`). */
export function visibleSummaryRows(summary: GroupSummary, hideEmpty: boolean): SummaryRow[] {
  return hideEmpty ? summary.rows.filter((r) => r.n > 0) : summary.rows;
}

// ── Selection state ────────────────────────────────────────────────────────

/** The keys a live pick names, and which facet panel (or the flat table / a
 *  non-faceted plot, `null`) the picking gesture happened in. An EMPTY
 *  slot's picked mark is scoped to this panel (P2.6 review finding 1): the
 *  same key picked in one facet panel must never paint as selected — on the
 *  table, on another panel, or on a non-faceted plot — because an empty
 *  slot's `rows` is always `[]` there too, so without the panel check the
 *  fallback below could not tell "picked here" from "picked somewhere else". */
export interface PickedKeys {
  keys: ReadonlySet<string>;
  panel: string | null;
}

export const NO_PICK: PickedKeys = { keys: new Set(), panel: null };

/** A local pick: the keys the last table/plot gesture named, which panel it
 *  happened in, and the row selection object that gesture left behind (see
 *  the module header). */
export interface GroupPick extends PickedKeys {
  basis: unknown;
  summary: GroupSummary;
}

export function isPickLive(pick: GroupPick | null, selection: unknown, summary: GroupSummary | null): boolean {
  return pick != null && pick.basis === selection && pick.summary === summary;
}

/** `row`'s rows inside `scope` (a facet panel's precomputed row list for
 *  this slot key, `LevelAxes.panelRows.get(panel)`), or all of them. */
function scoped(row: SummaryRow, scope?: PanelScope | null): readonly number[] {
  return scope ? scope.get(row.key) ?? [] : row.rows;
}

/** 2 = every row selected (or an empty group picked IN `panel`), 1 = some,
 *  0 = none. `panel` is the context being marked (the flat table / a
 *  non-faceted plot: `null`; a facet panel: its label) — an empty slot only
 *  reads as picked when `picked.panel` matches it (review finding 1). */
export function markOf(
  row: SummaryRow,
  selected: ReadonlySet<number>,
  picked: PickedKeys,
  panel: string | null = null,
  scope?: PanelScope | null,
): SlotMark {
  const rows = scoped(row, scope);
  if (!rows.length) return picked.keys.has(row.key) && picked.panel === panel ? 2 : 0;
  let k = 0;
  for (const r of rows) if (selected.has(r)) k++;
  return k === rows.length ? 2 : k > 0 ? 1 : 0;
}

/** How many of `row`'s rows are selected. */
export function selectedCount(row: SummaryRow, selected: ReadonlySet<number>): number {
  let k = 0;
  for (const r of row.rows) if (selected.has(r)) k++;
  return k;
}

export interface GestureMods {
  /** Ctrl / Cmd: toggle this group into / out of the selection. */
  toggle: boolean;
  /** Shift: the contiguous run of groups from the anchor to this one. */
  range: boolean;
}

export interface Gesture {
  /** The new row selection (original rows; unsorted, may repeat). */
  rows: number[];
  /** The new local pick. */
  keys: string[];
}

/** One click / keypress on the group `key` (a row of `visible`, the table's
 *  order), in `panel` (the flat table / a non-faceted plot: `null`; a facet
 *  panel: its label). `current` is the live row selection; `picked` the live
 *  pick. Returns null for a key not in `visible` (a stale gesture). */
export function applyGesture(
  visible: readonly SummaryRow[],
  key: string,
  mods: GestureMods,
  anchor: string | null,
  current: readonly number[],
  picked: PickedKeys,
  panel: string | null = null,
  scope?: PanelScope | null,
): Gesture | null {
  const at = visible.findIndex((r) => r.key === key);
  if (at < 0) return null;
  const row = visible[at];
  const from = mods.range && anchor != null ? visible.findIndex((r) => r.key === anchor) : -1;
  if (from >= 0) {
    const run = visible.slice(Math.min(from, at), Math.max(from, at) + 1);
    return { rows: run.flatMap((r) => [...scoped(r, scope)]), keys: run.map((r) => r.key) };
  }
  if (!mods.toggle) return { rows: [...scoped(row, scope)], keys: [key] };
  const sel = new Set(current);
  // Toggling starts (or continues) a pick scoped to THIS `panel` — keys a
  // previous gesture picked in a DIFFERENT panel do not carry over (review
  // finding 1: those must stay scoped to where they were picked).
  const keys = new Set(picked.panel === panel ? picked.keys : []);
  const theirs = scoped(row, scope);
  if (markOf(row, sel, picked, panel, scope) === 2) {
    const drop = new Set(theirs);
    keys.delete(key);
    return { rows: current.filter((r) => !drop.has(r)), keys: [...keys] };
  }
  keys.add(key);
  return { rows: [...current, ...theirs], keys: [...keys] };
}

// ── Plot marks ─────────────────────────────────────────────────────────────

/** The marks for one draw whose drawn slots are `drawSlots` (keyed), or null
 *  when the draw is not keyed (closed-up fallback: no reliable mapping) or
 *  nothing on it is selected. `panel` is the context being marked (see
 *  `markOf`). */
export function selectionMarks(
  drawSlots: readonly AxisSlot[] | null | undefined,
  byKey: ReadonlyMap<string, SummaryRow>,
  selected: ReadonlySet<number>,
  picked: PickedKeys,
  points: ReadonlySet<number>,
  panel: string | null = null,
  scope?: PanelScope | null,
): StatSelectionMarks | null {
  if (!drawSlots?.length || drawSlots.some((s) => s.key == null)) return null;
  const slots = drawSlots.map((s) => {
    const row = byKey.get(s.key as string);
    return row ? markOf(row, selected, picked, panel, scope) : 0;
  });
  return slots.some((m) => m > 0) || points.size ? { slots, points } : null;
}
