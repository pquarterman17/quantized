// Worksheet Quick Plot menu entries (PR F, L0.36/L0.38). A sibling of
// contextActions.ts (which sits at 499/500 lines -- no headroom) rather than
// another block inside it, same reason workbookContextActions.ts is its own
// file. L0.38's ordering places these right after the plot group (Open,
// Quick Plot, ...) -- datasetRowMenu.ts splices this pair in there.

import { CONFIGURE_QUICK_PLOT_STUB_REASON, quickPlotAvailability } from "./quickPlot";
import type { ContextAction, DatasetActionTarget } from "./contextActions";
import { useApp } from "../store/useApp";

export const datasetQuickPlotActions: ContextAction<DatasetActionTarget>[] = [
  {
    id: "dataset.quickPlot",
    label: "Quick Plot",
    enabled: (t) => quickPlotAvailability(t.dataset).available,
    disabledReason: (t) => {
      const availability = quickPlotAvailability(t.dataset);
      return availability.available ? "" : availability.reason;
    },
    run: (t) => {
      useApp.getState().quickPlotDataset(t.dataset.id);
      t.onStageOpen?.();
    },
  },
  {
    id: "dataset.configureQuickPlot",
    label: "Configure Quick Plot…",
    enabled: () => false,
    disabledReason: () => CONFIGURE_QUICK_PLOT_STUB_REASON,
    run: () => {},
  },
];
