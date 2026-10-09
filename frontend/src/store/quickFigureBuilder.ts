// Transient launch state for the Quick Figure Builder (LIBRARY_WORKBOOK_UX
// plan PR G). The builder edits a local draft; this slice deliberately stores
// only the source worksheet identity. Opening or cancelling therefore cannot
// mutate raw data, figures, templates, selection, or the surface underneath.

import type { AppState } from "./useApp";
import type { QuickFigureMapping } from "../lib/quickFigureMapping";

type SliceSet = (partial: Partial<AppState>) => void;

export interface QuickFigureBuilderSlice {
  quickFigureBuilderDatasetId: string | null;
  /** Optional caller-provided starting assignments. This is transient draft
   * state, not a saved template or a mutation of the worksheet. */
  quickFigureBuilderSeed: QuickFigureMapping | null;
  openQuickFigureBuilder: (datasetId: string, seed?: QuickFigureMapping) => boolean;
  closeQuickFigureBuilder: () => void;
}

export function createQuickFigureBuilderSlice(set: SliceSet, get: () => AppState): QuickFigureBuilderSlice {
  return {
    quickFigureBuilderDatasetId: null,
    quickFigureBuilderSeed: null,
    openQuickFigureBuilder: (datasetId, seed) => {
      if (!get().datasets.some((dataset) => dataset.id === datasetId)) {
        set({ status: "Quick Figure Builder unavailable: worksheet not found" });
        return false;
      }
      set({
        quickFigureBuilderDatasetId: datasetId,
        quickFigureBuilderSeed: seed ? {
          ...seed,
          yKeys: [...seed.yKeys],
          errorBindings: seed.errorBindings.map((binding) => ({ ...binding })),
          ignoredKeys: [...seed.ignoredKeys],
          ...(seed.xKeyByY ? { xKeyByY: { ...seed.xKeyByY } } : {}),
        } : null,
      });
      return true;
    },
    closeQuickFigureBuilder: () => set({ quickFigureBuilderDatasetId: null, quickFigureBuilderSeed: null }),
  };
}
