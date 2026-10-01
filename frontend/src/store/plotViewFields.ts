// THE LIVE PLOTVIEW FIELDS, extracted from store/useApp.ts (audit P4.1, the
// tenth domain — store-size ratchet, MAIN_PLAN #2). Composed into the ONE
// useApp store like ./datasetSelection: `useApp` spreads
// `createPlotViewFieldsSlice(defaultGrid)` into the store, so every
// `useApp((s) => s.yScale)` selector keeps working. A code boundary, not a
// second store.
//
// WHAT THIS MODULE OWNS: the declaration and initial value of the singleton
// PlotView fields (yScale … waterfall) — the FOCUSED window's live view (see
// the facade doc on WindowsSlice, store/windows.ts). A state-only slice: the
// writers are store/plotViewSettings.ts's actions, and the dataset-switch
// resets and bulk applies (setActive/addDataset, loadWorkspace,
// applyOriginFigure, facetByColumn/breakAtGaps) live with their gestures.
// The PlotView fields declared elsewhere stay there: legendXY/legendSize/
// legendFrameXY/axisLabelOffsets/axisLabelStyles (./pointerTool), shapes
// (./shapes), regionShades (./regionShades), waterfallDx (./plotViewSettings).
//
// The initial values must keep matching `defaultPlotView()` (lib/plotview),
// except `showGrid`, which starts at the persisted `defaultGrid` preference —
// MULTI_PLOT_PLAN decision #6: the first window is indistinguishable from
// "no windows yet". Pinned by store/plotViewFields.characterization.test.ts,
// written green against the pre-extraction useApp.ts.
//
// WHAT IT MUST NOT IMPORT: nothing from `../components`, no React; only types.

import type { HalfLim } from "../lib/axisLim";
import type { Composition } from "../lib/composition";
import type { PageSetup } from "../lib/pagesetup";
import type { PanelFit } from "../lib/panelLayout";
import type { PlotView } from "../lib/plotview";
import type { Annotation, AxisFormat, AxisScale, RefLine, SeriesStyle } from "../lib/types";
import type { LegendPos } from "./useApp";

export interface PlotViewFieldsSlice {
  yScale: AxisScale; // Y axis scale (MAIN #12: linear/log/reciprocal)
  xScale: AxisScale; // X axis scale
  showGrid: boolean; // draw the plot grid lines
  showLegend: boolean; // show the floating legend overlay
  legendPos: LegendPos; // which corner the floating legend pins to
  legendStatic: boolean; // clean read-only legend (Origin apply, decode #52)
  legendTitle: string | null; // legend header text (Origin apply, decode #52)
  plotTemplate: string; // on-screen publication template (base font + line width)
  showAxisBox: boolean; // full frame on all four sides of the plot area (on by default)
  stackMode: boolean; // multi-panel: one stacked sub-plot per channel
  panelFit: PanelFit; // #54: how a spatial multi-panel view fills the stage (PlotView field)
  pageSetup: PageSetup | null; // #54: this window's physical page model (PlotView field; null = none)
  // How the stage is arranged into panels (#54 pass A): ONE discriminated
  // union replacing the former parallel `spatialPanels`/`facetPanels`/
  // `breakPanels` nullable arrays, whose mutual exclusion every assigning
  // `set()` had to re-enforce by hand. `null` = no multi-panel arrangement.
  // Set by `applyOriginFigure` (spatial), `facetByColumn` (facet) and
  // `breakAtGaps` (break); cleared by `setStackMode` and `setActive` so a
  // manual toggle or a different dataset never shows a stale arrangement.
  // EPHEMERAL — never persisted directly; a `.dwk` restore/focus switch
  // nulls it. For FACET specifically (FIGURE_AUTHORING_WORKFLOW_PLAN F4.4)
  // this is no longer a durability gap: `facetKey` below is the durable
  // binding (bindings-owned, survives save/reopen/recipe-apply exactly like
  // `groupKey`), and `MultiPanelStage.tsx` rebuilds this field on demand from
  // it (`lib/facet.facetCompositionFromBinding`) whenever it's null — see
  // that component's own doc. Spatial/break stay genuinely ephemeral (no
  // binding to rebuild from). Each kind's panel shape, why the three differ,
  // and the reference-stable accessors: `lib/composition.ts`.
  composition: Composition | null;
  insetMode: boolean; // show a magnifier inset over the plot
  polarMode: boolean; // render the active series in polar (angle vs radius)
  statMode: boolean; statHideEmptyLevels: boolean; statShowGroupN: boolean; statShowSummary: boolean; statMarks: PlotView["statMarks"]; statPicks: PlotView["statPicks"]; // Statistics stage (gap #16) + its P2.6 options + its picks
  xLim: HalfLim | null; // explicit X range (null = autoscale; a null side = auto for that side)
  yLim: HalfLim | null; // explicit Y range (same)
  // Origin's decoded major-tick increment for a FIXED log axis (plot-fidelity
  // fix #2) — only meaningful alongside xLim/yLim/y2Lim; see
  // `lib/uplotOpts.fixedLogAxisSplits`'s doc. null = undecoded (falls back to
  // a "nice number" step). Reset whenever the paired *Lim is reset/replaced
  // by anything other than an Origin figure apply, so a stale step never
  // leaks onto an unrelated manual range.
  xStep: number | null;
  yStep: number | null;
  xFmt: AxisFormat; // X-axis tick number format
  yFmt: AxisFormat; // Y-axis tick number format (default source for y2Fmt when null)
  y2Fmt: AxisFormat | null; // secondary-axis tick format; null = inherit yFmt (default)
  plotTitle: string; // chart title rendered above the plot ("" = none)
  xAxisLabel: string; // override for the x-axis label ("" = auto from data)
  yAxisLabel: string; // override for the primary y-axis label ("" = auto)
  xKey: number | null; // value channel used as the plot x-axis (null = .time)
  yKeys: number[] | null; // which value channels to plot (null = all)
  groupKey: number | null; // P1.5 "Group" well channel — splits each plotted Y into one series per level
  // F4.4: the durable facet-by-column binding (bindings-owned like groupKey
  // — see `composition`'s doc above). `facetByColumn` sets it; a genuine
  // dataset switch resets it (`store/windowDefaults.ts`'s
  // `datasetViewDefaults`, same treatment as groupKey).
  facetKey: number | null;
  y2Keys: number[] | null; // channels drawn on the secondary (right) Y axis
  y2Lim: [number, number] | null; // fixed secondary-Y range (Origin double-Y apply)
  y2Scale: AxisScale | null; // secondary-Y scale (null = inherit yScale)
  y2Step: number | null; // decoded major-tick increment for y2Lim (see xStep/yStep)
  y2AxisLabel: string; // override for the secondary y-axis label ("" = auto)
  refLines: RefLine[]; // fixed X/Y marker lines on the plot
  annotations: Annotation[]; // text labels pinned at data coordinates
  seriesStyles: Record<number, SeriesStyle>; // per-channel color/width/line overrides
  seriesLabels: Record<number, string>; // per-channel display-name overrides (legend rename)
  errKeys: Record<number, number>; // y-channel index → channel holding its ± error (error bars)
  seriesOrder: number[] | null; // explicit plotted-channel draw order (null = natural/yKeys order)
  hiddenChannels: number[]; // channels toggled off via the interactive legend (kept in payload, not drawn)
  waterfall: number; // waterfall offset as a fraction of the y-span (0 = off)
}

/** `defaultGrid` is the persisted pref (store/prefs.ts) that seeds `showGrid`. */
export function createPlotViewFieldsSlice(defaultGrid: boolean): PlotViewFieldsSlice {
  return {
    yScale: "linear",
    xScale: "linear",
    showGrid: defaultGrid,
    showLegend: true,
    legendPos: "ne",
    legendStatic: false,
    legendTitle: null,
    plotTemplate: "screen",
    showAxisBox: true,
    stackMode: false,
    panelFit: "frames",
    pageSetup: null,
    composition: null,
    insetMode: false,
    polarMode: false,
    statMode: false, statHideEmptyLevels: false, statShowGroupN: true, statShowSummary: false, statMarks: {}, statPicks: {},
    xLim: null,
    yLim: null,
    xStep: null,
    yStep: null,
    xFmt: { mode: "auto", digits: 2 },
    yFmt: { mode: "auto", digits: 2 },
    y2Fmt: null,
    plotTitle: "",
    xAxisLabel: "",
    yAxisLabel: "",
    xKey: null,
    yKeys: null,
    groupKey: null,
    facetKey: null,
    y2Keys: null,
    y2Lim: null,
    y2Scale: null,
    y2Step: null,
    y2AxisLabel: "",
    refLines: [],
    annotations: [],
    seriesStyles: {},
    seriesLabels: {},
    errKeys: {},
    seriesOrder: null,
    hiddenChannels: [],
    waterfall: 0,
  };
}
