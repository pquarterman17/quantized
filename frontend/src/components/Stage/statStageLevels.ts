// Stat Stage x missing levels (PRIMARY_SOFTWARE_AUDIT_PLAN P2.6 box 2): puts
// the axis accounting of `lib/groupAxis` onto the draws the stage already
// computes, and says what it found.
//
// It DECORATES rather than recomputes. The stage's compute path
// (`useStatStage` -> `useStatStageCompute`) is unchanged: it still asks the
// backend for box stats / KDEs of the NON-EMPTY groups only (an empty group has
// no statistics to ask for). This module then threads those draws onto an
// axis that also carries the empty slots, relabels their groups with the
// axis's ONE label resolution, pads a bar matrix with its empty categories,
// and builds the one-line notice — so the screen, the flat export and the
// faceted export all read the same slots, labels and caveat.
//
// FRESHNESS. A draw is threaded only when it was computed for the CURRENT
// picks (`useStatStageDraws` keys every draw to its inputs). A stale one —
// the async compute still holding the previous grouping — renders exactly as
// computed, with no notice, until the new one lands: never an old grouping on
// a new axis, never a count that describes neither.
//
// Pure (no React, no store): `useStatStage` memoizes `levelAxes` (data +
// picks) apart from `applyLevels` (draws + display options).

import type { BarChartData, BarGroup } from "../../lib/barlayout";
import { resolveCategoryLabels } from "../../lib/barlayout";
import { categoryLevels } from "../../lib/categorical";
import type { FacetSlice } from "../../lib/facet";
import {
  alignSlots,
  countGroupAxis,
  groupNotice,
  levelUniverse,
  planGroupAxis,
  visibleSlots,
  type AxisSlot,
  type CountedGroup,
  type GroupAxis,
  type GroupNotice,
} from "../../lib/groupAxis";
import { droppedRows } from "../../lib/rowstate";
import type { StatMode } from "../../lib/statstage";
import type { DataStruct, Dataset } from "../../lib/types";
import type { StatDrawData } from "./statRender";
import type { FacetDraw } from "./useStatStageCompute";

export interface LevelsInput {
  active: Dataset | null;
  /** The analysis view (exclusion + Data Filter pruned). */
  data: DataStruct | null;
  mode: StatMode;
  groupCol: number | null;
  /** The mode-gated nested factor (null outside box/violin/strip). */
  group2Col: number | null;
  valueCol: number;
  plotted: readonly number[];
  barValueChannels: readonly number[];
  facetCol: number | null;
  /** The facet slices of `data` the compute effect partitions by — reused,
   *  never re-sliced here. Null when not faceted. */
  slices: readonly FacetSlice[] | null;
}

/** The two display options — the only inputs that change a decoration
 *  without changing an axis. */
export interface LevelsDisplay {
  hideEmpty: boolean;
  showN: boolean;
}

const CATEGORICAL: readonly StatMode[] = ["box", "violin", "strip", "bar"];

/** Every axis the stage can need for these picks: the whole-plot one, one
 *  per facet slice (keyed by the slice label), and the facet levels that have
 *  no slice at all. The level universe, its labels and the cap are PLANNED
 *  once and every axis is only a count over its own rows. */
export interface LevelAxes {
  flat: GroupAxis;
  panels: Map<string, GroupAxis> | null;
  /** Facet levels (declared or carried by any row) with no slice in the
   *  analysis view — every row excluded / filtered out. */
  facetGone: string[];
  /** Facet codes keyed by slice label, to tell which levels got no PANEL. */
  facetCodeOf: Map<string, number> | null;
}

export function levelAxes(p: LevelsInput): LevelAxes | null {
  if (!p.active || !p.data || !CATEGORICAL.includes(p.mode)) return null;
  const bar = p.mode === "bar";
  const full = p.active.data;
  const plan = planGroupAxis(
    full, p.groupCol, bar ? null : p.group2Col,
    bar ? p.barValueChannels : p.plotted.length ? p.plotted : [p.valueCol], !bar,
  );
  const valueCols = bar ? p.barValueChannels : [p.valueCol];
  const flat = countGroupAxis(plan, full, droppedRows(p.active), valueCols);
  if (p.facetCol == null || !p.slices) {
    return { flat, panels: null, facetGone: [], facetCodeOf: null };
  }
  const none = new Set<number>();
  const panels = new Map(p.slices.map((s) => [s.label, countGroupAxis(plan, s.data, none, valueCols)] as const));
  // facetSlices is one slice per `categoryLevels(data, facetCol)` code, in order.
  const present = categoryLevels(p.data, p.facetCol);
  const facetCodeOf = new Map(p.slices.map((s, i) => [s.label, present[i]] as const));
  const all = levelUniverse(full, p.facetCol);
  const texts = resolveCategoryLabels(full, p.facetCol, all);
  const facetText = new Map(all.map((code, i) => [code, texts[i]] as const));
  const presentSet = new Set(present);
  const facetGone = all.filter((c) => !presentSet.has(c)).map((c) => facetText.get(c) ?? String(c));
  return { flat, panels, facetGone, facetCodeOf };
}

const hasData = (g: BarGroup) => g.series.some((s) => s.n > 0);

/** The plotted groups' labels, in draw order (bar: the categories that have
 *  data — the ones that fill a slot). */
function groupLabels(d: StatDrawData): string[] | null {
  switch (d.mode) {
    case "box":
    case "strip":
      return d.boxes.map((b) => b.label);
    case "violin":
      return d.violins.map((v) => v.label);
    case "bar":
      return d.data.groups.filter(hasData).map((g) => g.label);
    default:
      return null;
  }
}

/** Bar: each filled slot keeps its computed group (under the slot's label),
 *  each empty one becomes an all-NaN / n=0 category (drawn as an empty slot,
 *  exported as nulls). */
function padBarData(data: BarChartData, slots: readonly AxisSlot[]): BarChartData {
  const filled = data.groups.filter(hasData);
  const blank = () => data.seriesLabels.map(() => ({ mean: Number.NaN, sem: Number.NaN, n: 0 }));
  return {
    seriesLabels: data.seriesLabels,
    groups: slots.map((s) =>
      s.group === null ? { label: s.label, series: blank() } : { ...filled[s.group], label: s.label },
    ),
  };
}

/** Rename every plotted group to its slot's label (`aligned` is the FULL
 *  aligned axis, so hiding empties cannot shift the mapping). */
function relabel(draw: StatDrawData, aligned: readonly AxisSlot[]): StatDrawData {
  const byGroup = aligned.filter((s) => s.group !== null).map((s) => s.label);
  const at = (i: number, fallback: string) => byGroup[i] ?? fallback;
  switch (draw.mode) {
    case "box":
      return { ...draw, boxes: draw.boxes.map((b, i) => ({ ...b, label: at(i, b.label) })),
        points: draw.points?.map((g, i) => ({ ...g, label: at(i, g.label) })) ?? draw.points };
    case "strip":
      return { ...draw, boxes: draw.boxes.map((b, i) => ({ ...b, label: at(i, b.label) })),
        points: draw.points.map((g, i) => ({ ...g, label: at(i, g.label) })) };
    case "violin":
      return { ...draw, violins: draw.violins.map((v, i) => ({ ...v, label: at(i, v.label) })) };
    default:
      return draw;
  }
}

export interface Decorated {
  draw: StatDrawData;
  /** The FULL aligned axis (hide-empty not applied), or null when the draw
   *  could not be threaded onto it (it then renders exactly as before). */
  aligned: AxisSlot[] | null;
}

/** Thread one draw onto `axis` (see the module header). */
export function decorateDraw(
  draw: StatDrawData,
  axis: GroupAxis | null,
  hideEmpty: boolean,
  showN: boolean,
): Decorated {
  const labels = groupLabels(draw);
  if (!labels) return { draw, aligned: null };
  const aligned = axis ? alignSlots(axis.slots, labels.length) : null;
  if (draw.mode === "bar") {
    const data = aligned
      ? padBarData(draw.data, visibleSlots(aligned, hideEmpty))
      : { ...draw.data, groups: hideEmpty ? draw.data.groups.filter(hasData) : draw.data.groups };
    return { draw: { ...draw, data, showN }, aligned };
  }
  if (draw.mode !== "box" && draw.mode !== "strip" && draw.mode !== "violin") return { draw, aligned: null };
  if (!aligned) return { draw: { ...draw, slots: null, showN }, aligned };
  return { draw: { ...relabel(draw, aligned), slots: visibleSlots(aligned, hideEmpty), showN } as StatDrawData, aligned };
}

/** What the notice counts for the caveat: every box-family group, or every
 *  bar (category x series cell) that has data. */
function counted(draw: StatDrawData, prefix = ""): CountedGroup[] {
  switch (draw.mode) {
    case "bar": {
      const multi = draw.data.seriesLabels.length > 1;
      return draw.data.groups.flatMap((g) =>
        g.series.flatMap((s, si) =>
          s.n > 0 ? [{ label: `${prefix}${g.label}${multi ? ` · ${draw.data.seriesLabels[si]}` : ""}`, n: s.n }] : [],
        ),
      );
    }
    case "box":
      return draw.boxes.map((b) => ({ label: `${prefix}${b.label}`, n: b.n }));
    case "strip":
      return draw.points.map((g) => ({ label: `${prefix}${g.label}`, n: g.points.length }));
    case "violin":
      return draw.violins.map((v) => ({ label: `${prefix}${v.label}`, n: v.n }));
    default:
      return [];
  }
}

export interface LevelsResult {
  draw: StatDrawData | null;
  drawFacets: FacetDraw[] | null;
  notice: GroupNotice | null;
}

/** Decorate the flat draw or every facet panel, and build the notice.
 *  `fresh` says, per kind, whether the stored draw was computed for the picks
 *  `axes` describe; a stale one is neither decorated nor described (module
 *  header). */
export function applyLevels(
  axes: LevelAxes | null,
  opts: LevelsDisplay,
  draw: StatDrawData | null,
  drawFacets: FacetDraw[] | null,
  fresh: { draw: boolean; facets: boolean } = { draw: true, facets: true },
): LevelsResult {
  if (!axes) return { draw, drawFacets, notice: null };
  const { flat } = axes;
  const base = { hiddenAbsent: flat.hiddenAbsent, unassigned: flat.unassigned };
  if (drawFacets && axes.panels) {
    if (!fresh.facets) return { draw, drawFacets, notice: null };
    let allAligned = true;
    const panels = drawFacets.map((f) => {
      const d = decorateDraw(f.draw, axes.panels?.get(f.label) ?? null, opts.hideEmpty, opts.showN);
      if (!d.aligned) allAligned = false;
      return { ...f, draw: d.draw };
    });
    // A facet level with no panel: none in the analysis view at all, or a
    // slice the compute dropped for having no usable value.
    const drawnCodes = new Set(drawFacets.map((f) => axes.facetCodeOf?.get(f.label)));
    const noPanel = [...(axes.facetCodeOf ?? new Map<string, number>()).entries()]
      .filter(([, code]) => !drawnCodes.has(code))
      .map(([label]) => label);
    const notice = groupNotice({
      ...base,
      // "(n=0)" only if every panel really shows its empty slots.
      hideEmpty: opts.hideEmpty || !allAligned,
      slots: flat.slots,
      counted: panels.flatMap((f) => counted(f.draw, `${f.label}: `)),
      missingPanels: [...axes.facetGone, ...noPanel],
    });
    return { draw, drawFacets: panels, notice };
  }
  if (!draw || !fresh.draw) return { draw, drawFacets, notice: null };
  const { draw: decorated, aligned } = decorateDraw(draw, flat, opts.hideEmpty, opts.showN);
  // When the draw could not be threaded onto the axis it renders closed up,
  // as before — so its empty levels are NOT on screen: "hidden", not "(n=0)".
  const notice = groupNotice({
    ...base,
    hideEmpty: opts.hideEmpty || !aligned,
    slots: aligned ?? flat.slots,
    counted: counted(decorated),
  });
  return { draw: decorated, drawFacets, notice };
}
