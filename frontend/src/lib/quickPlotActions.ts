// Worksheet Quick Plot menu entries (PR F, L0.36/L0.38). A sibling of
// contextActions.ts (which sits at 499/500 lines -- no headroom) rather than
// another block inside it, same reason workbookContextActions.ts is its own
// file. L0.38's ordering places these right after the plot group (Open,
// Quick Plot, ...) -- `withQuickPlot` below applies that splice to any
// dataset-action list that leads with the plot group, so it is written
// ONCE and shared by datasetRowMenu.ts (the row's context menu) AND
// paletteContextActions.ts (the ⌘K palette's flat `datasetActions` list --
// review fix #3: that list is the ONLY real consumer of `datasetActions`
// outside its own definition, so this is the actual assembly seam, not
// contextActions.ts itself, which has no line-budget room left).

import { quickPlotAvailability } from "./quickPlot";
import type { ContextAction, DatasetActionTarget } from "./contextActions";
import { useApp } from "../store/useApp";
import { openQuickPlotWith } from "../store/quickPlotWithDialog";

export const datasetQuickPlotActions: ContextAction<DatasetActionTarget>[] = [
  {
    id: "dataset.quickPlot",
    label: "Quick Plot",
    enabled: (t) => quickPlotAvailability(t.dataset).available,
    disabledReason: (t) => {
      const availability = quickPlotAvailability(t.dataset);
      return availability.available ? "" : availability.reason;
    },
    // quickPlotDataset returns true only on success (fix #6) -- a
    // fail-closed refusal has no plot to return the Stage to.
    run: (t) => {
      if (useApp.getState().quickPlotDataset(t.dataset.id)) t.onStageOpen?.();
    },
  },
  {
    id: "dataset.configureQuickPlot",
    label: "Configure Quick Plot…",
    run: (t) => {
      useApp.getState().openQuickFigureBuilder(t.dataset.id);
    },
  },
  {
    id: "dataset.quickPlotWith",
    label: "Quick Plot With…",
    // L0.37: the chooser has no useful content before any template exists —
    // hidden outright rather than a permanently-disabled entry.
    hidden: () => useApp.getState().quickPlotTemplates.length === 0,
    run: (t) => openQuickPlotWith(t.dataset.id),
  },
];

const PLOT_GROUP_IDS = new Set(["dataset.plot", "dataset.plotInNewWindow"]);

/** L0.38's ordering (Open, Quick Plot, ...): splice `datasetQuickPlotActions`
 *  right after the "plot" group inside `actions`, leaving every other
 *  action's relative order untouched. Shared splice logic so the row menu
 *  and the palette can never drift apart on where Quick Plot lands. */
export function withQuickPlot(
  actions: readonly ContextAction<DatasetActionTarget>[],
): ContextAction<DatasetActionTarget>[] {
  const plotGroup = actions.filter((a) => PLOT_GROUP_IDS.has(a.id));
  const rest = actions.filter((a) => !PLOT_GROUP_IDS.has(a.id));
  return [...plotGroup, ...datasetQuickPlotActions, ...rest];
}
