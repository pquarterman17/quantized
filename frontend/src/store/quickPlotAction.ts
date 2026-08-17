// Quick Plot's store action (PR F, plan L0.7). A sibling slice file rather
// than another method on FigureLifecycleSlice -- figureLifecycle.ts sits
// close enough to the general 500-line ceiling (architecture.test.ts) that
// this action would push it over; same "extract a cohesive sibling instead
// of raising the pin" convention store/datasetMeta.ts and store/cellEdit.ts
// already follow.
//
// Follows promoteLegacyFigureDoc's exact shape (figureLifecycle.ts): guard
// the dataset exists and passes quickPlotAvailability (fail-closed no-op
// with a status message otherwise -- a keystroke/menu race must never plot
// unrecognized data), mint a FRESH id, build a new FigureDocument in "live"
// mode, record history once, APPEND to editableFigures (never look up an
// existing document by datasetId and overwrite it -- L0.7's "never replace
// an existing figure" is structural, not a policy someone could forget),
// then open it.

import { createFigureDocument } from "../lib/figureDocument";
import { quickPlotAvailability, quickPlotFigureSeed } from "../lib/quickPlot";
import { nextFigureId } from "./figureLifecycle";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export interface QuickPlotActionSlice {
  /** Create a NEW editable figure from a recognized worksheet. No-op (with a
   *  status message) when the dataset is missing or unrecognized -- see
   *  lib/quickPlot.ts's quickPlotAvailability for the exact gate. */
  quickPlotDataset: (datasetId: string) => void;
}

export function createQuickPlotActionSlice(set: SliceSet, get: SliceGet): QuickPlotActionSlice {
  return {
    quickPlotDataset: (datasetId) => {
      const state = get();
      const dataset = state.datasets.find((d) => d.id === datasetId);
      if (!dataset) {
        set({ status: "Quick Plot unavailable: dataset not found" });
        return;
      }
      const availability = quickPlotAvailability(dataset);
      if (!availability.available) {
        set({ status: `Quick Plot unavailable for "${dataset.name}": ${availability.reason}` });
        return;
      }
      const seed = quickPlotFigureSeed(dataset);
      const id = nextFigureId();
      const document = createFigureDocument({
        id,
        name: seed.name,
        datasetId: dataset.id,
        view: seed.view,
      });
      state.recordHistory("quick plot");
      set((current) => ({
        editableFigures: [...current.editableFigures, document],
        status: `created "${document.name}" from Quick Plot`,
      }));
      get().openEditableFigure(id);
    },
  };
}
