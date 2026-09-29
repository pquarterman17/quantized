// The plot-curve (series) context-action registry (GUI_INTERACTION #8),
// moved verbatim out of lib/contextActions.ts (bundle diet slice 12,
// plans/BUNDLE_HEADROOM.md). Its one consumer, lib/plotMenu.ts, is already
// lazy (the plot-canvas context menu, slice 4), so this module loads with
// that menu instead of riding in the entry chunk.

import type { ContextAction } from "./contextActions";
import type { MenuSeries, PlotMenuContext } from "./plotMenu";

// ── plot curve (series) registry ────────────────────────────────────────

export interface CurveActionTarget {
  series: MenuSeries;
  ctx: PlotMenuContext;
  /** Whether any style field on this series has been overridden — gates
   *  "Reset series style". */
  overridden: boolean;
}

export const curveActions: ContextAction<CurveActionTarget>[] = [
  {
    id: "curve.toggleHidden",
    label: (t) => (t.series.hidden ? "Show series" : "Hide series"),
    enabled: (t) => t.series.hidden || t.ctx.canHide,
    run: (t) => t.ctx.toggleHidden(t.series.channel),
  },
  { id: "curve.rename", label: "Rename…", run: (t) => t.ctx.rename(t.series.channel) },
  {
    id: "curve.toggleY2",
    label: (t) => (t.series.onY2 ? "Move to left Y axis" : "Move to right Y axis"),
    run: (t) => t.ctx.toggleY2(t.series.channel),
  },
  // GUI_INTERACTION #3 sub-item 4: the menu-path equivalent of the legend
  // row's own draw-order reorder (its up/down arrow buttons + its own
  // right-click menu) — now defined ONCE here so the plot-canvas right-click
  // (lib/plotMenu.ts's curve menu) offers the same reorder PlotLegend always
  // has, instead of it being legend-only.
  {
    id: "curve.moveEarlier",
    label: "Move earlier (draw under)",
    enabled: (t) => t.ctx.canMoveSeries(t.series.channel, -1),
    run: (t) => t.ctx.moveSeries(t.series.channel, -1),
  },
  {
    id: "curve.moveLater",
    label: "Move later (draw over)",
    enabled: (t) => t.ctx.canMoveSeries(t.series.channel, 1),
    run: (t) => t.ctx.moveSeries(t.series.channel, 1),
  },
  {
    id: "curve.resetStyle",
    label: "Reset series style",
    hidden: (t) => !t.overridden,
    run: (t) => t.ctx.resetStyle(t.series.channel),
  },
];
