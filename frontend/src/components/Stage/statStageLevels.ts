// Stat Stage x missing levels (PRIMARY_SOFTWARE_AUDIT_PLAN P2.6 box 2): puts
// the axis accounting of `lib/groupAxis` onto the draws the stage already
// computes, and says what it found.
//
// It DECORATES rather than recomputes. The stage's compute path
// (`useStatStage` -> `useStatStageCompute`) is unchanged: it still asks the
// backend for box stats / KDEs of the NON-EMPTY groups only (an empty group has
// no statistics to ask for). This module then threads those draws onto an
// axis that also carries the empty slots, pads a bar matrix with its empty
// categories, and builds the one-line notice — so the screen, the flat export
// and the faceted export all read the same slots and the same caveat.
//
// Pure (no React, no store): `useStatStageLevels` is the hook wrapper.

import type { BarChartData, BarGroup } from "../../lib/barlayout";
import { facetSlices } from "../../lib/facet";
import {
  alignSlots,
  buildGroupAxis,
  groupNotice,
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
}

/** The two display options — the only inputs that change a decoration
 *  without changing an axis. */
export interface LevelsDisplay {
  hideEmpty: boolean;
  showN: boolean;
}

const CATEGORICAL: readonly StatMode[] = ["box", "violin", "strip", "bar"];

function axisFor(p: LevelsInput, rows: DataStruct, dropped: ReadonlySet<number>): GroupAxis | null {
  if (!p.active || !CATEGORICAL.includes(p.mode)) return null;
  const bar = p.mode === "bar";
  return buildGroupAxis({
    levels: p.active.data,
    rows,
    dropped,
    groupCol: p.groupCol,
    group2Col: bar ? null : p.group2Col,
    valueCols: bar ? p.barValueChannels : [p.valueCol],
    fallbackCols: bar ? p.barValueChannels : p.plotted.length ? p.plotted : [p.valueCol],
    prefixed: !bar,
  });
}

/** The whole-plot axis: every row of the dataset, with its dropped rows. */
export function flatAxis(p: LevelsInput): GroupAxis | null {
  return p.active ? axisFor(p, p.active.data, droppedRows(p.active)) : null;
}

const hasData = (g: BarGroup) => g.series.some((s) => s.n > 0);

/** The plotted groups' labels and sample sizes, in draw order. */
function drawnGroups(d: StatDrawData): CountedGroup[] | null {
  switch (d.mode) {
    case "box":
      return d.boxes.map((b) => ({ label: b.label, n: b.n }));
    case "strip":
      return d.points.map((g) => ({ label: g.label, n: g.points.length }));
    case "violin":
      return d.violins.map((v) => ({ label: v.label, n: v.n }));
    case "bar":
      return d.data.groups.filter(hasData).map((g) => ({ label: g.label, n: 0 }));
    default:
      return null;
  }
}

/** Bar: each filled slot keeps its computed group, each empty one becomes an
 *  all-NaN / n=0 category (drawn as an empty slot, exported as nulls). */
function padBarData(data: BarChartData, slots: readonly AxisSlot[]): BarChartData {
  const filled = data.groups.filter(hasData);
  const blank = () => data.seriesLabels.map(() => ({ mean: Number.NaN, sem: Number.NaN, n: 0 }));
  return {
    seriesLabels: data.seriesLabels,
    groups: slots.map((s) => (s.group === null ? { label: s.label, series: blank() } : filled[s.group])),
  };
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
  const groups = drawnGroups(draw);
  if (!groups) return { draw, aligned: null };
  const aligned = axis ? alignSlots(axis.slots, groups.map((g) => g.label)) : null;
  if (draw.mode === "bar") {
    const data = aligned
      ? padBarData(draw.data, visibleSlots(aligned, hideEmpty))
      : { ...draw.data, groups: hideEmpty ? draw.data.groups.filter(hasData) : draw.data.groups };
    return { draw: { ...draw, data, showN }, aligned };
  }
  if (draw.mode !== "box" && draw.mode !== "strip" && draw.mode !== "violin") return { draw, aligned: null };
  const slots = aligned ? visibleSlots(aligned, hideEmpty) : null;
  return { draw: { ...draw, slots, showN }, aligned };
}

/** What the notice counts for the caveat: every box-family group, or every
 *  bar (category x series cell) that has data. */
function counted(draw: StatDrawData, prefix = ""): CountedGroup[] {
  if (draw.mode === "bar") {
    const multi = draw.data.seriesLabels.length > 1;
    return draw.data.groups.flatMap((g) =>
      g.series.flatMap((s, si) =>
        s.n > 0 ? [{ label: `${prefix}${g.label}${multi ? ` · ${draw.data.seriesLabels[si]}` : ""}`, n: s.n }] : [],
      ),
    );
  }
  return (drawnGroups(draw) ?? []).map((g) => ({ label: `${prefix}${g.label}`, n: g.n }));
}

export interface LevelsResult {
  draw: StatDrawData | null;
  drawFacets: FacetDraw[] | null;
  notice: GroupNotice | null;
}

/** Every axis the stage can need for these picks: the whole-plot one, and
 *  (faceted) one per facet slice, keyed by the slice label. Depends on the
 *  DATA and the picks only — not on the draws or the display options — so the
 *  hook memoizes it apart from `applyLevels` (review: toggling "n" must not
 *  re-slice and re-walk the dataset). */
export interface LevelAxes {
  flat: GroupAxis;
  panels: Map<string, GroupAxis | null> | null;
}

export function levelAxes(p: LevelsInput): LevelAxes | null {
  const flat = flatAxis(p);
  if (!flat || !p.data) return null;
  if (p.facetCol == null) return { flat, panels: null };
  const none = new Set<number>();
  const panels = new Map(facetSlices(p.data, p.facetCol).map((s) => [s.label, axisFor(p, s.data, none)] as const));
  return { flat, panels };
}

/** Decorate the flat draw or every facet panel, and build the notice. */
export function applyLevels(
  axes: LevelAxes | null,
  opts: LevelsDisplay,
  draw: StatDrawData | null,
  drawFacets: FacetDraw[] | null,
): LevelsResult {
  if (!axes) return { draw, drawFacets, notice: null };
  const { flat } = axes;
  const base = { hiddenAbsent: flat.hiddenAbsent, unassigned: flat.unassigned };
  if (drawFacets && axes.panels) {
    const panels = drawFacets.map((f) => ({
      ...f,
      draw: decorateDraw(f.draw, axes.panels?.get(f.label) ?? null, opts.hideEmpty, opts.showN).draw,
    }));
    const notice = groupNotice({
      ...base,
      hideEmpty: opts.hideEmpty,
      slots: flat.slots,
      counted: panels.flatMap((f) => counted(f.draw, `${f.label}: `)),
      droppedPanels: axes.panels.size - drawFacets.length,
    });
    return { draw, drawFacets: panels, notice };
  }
  if (!draw) return { draw, drawFacets, notice: null };
  const { draw: decorated, aligned } = decorateDraw(draw, flat, opts.hideEmpty, opts.showN);
  // Review: when the draw could not be threaded onto the axis it renders
  // closed up, as before — so its empty levels are NOT on screen, and the
  // notice must say "hidden", not "(n=0)".
  const notice = groupNotice({
    ...base,
    hideEmpty: opts.hideEmpty || !aligned,
    slots: aligned ?? flat.slots,
    counted: counted(decorated),
  });
  return { draw: decorated, drawFacets, notice };
}
