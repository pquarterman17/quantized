// Transient launch state for the Quick Figure Builder (LIBRARY_WORKBOOK_UX
// plan PR G). The builder edits a local draft; this slice deliberately stores
// only the source worksheet identity. Opening or cancelling therefore cannot
// mutate raw data, figures, templates, selection, or the surface underneath.

import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState>) => void;

export interface QuickFigureBuilderSlice {
  quickFigureBuilderDatasetId: string | null;
  openQuickFigureBuilder: (datasetId: string) => boolean;
  closeQuickFigureBuilder: () => void;
}

export function createQuickFigureBuilderSlice(set: SliceSet, get: () => AppState): QuickFigureBuilderSlice {
  return {
    quickFigureBuilderDatasetId: null,
    openQuickFigureBuilder: (datasetId) => {
      if (!get().datasets.some((dataset) => dataset.id === datasetId)) {
        set({ status: "Quick Figure Builder unavailable: worksheet not found" });
        return false;
      }
      set({ quickFigureBuilderDatasetId: datasetId });
      return true;
    },
    closeQuickFigureBuilder: () => set({ quickFigureBuilderDatasetId: null }),
  };
}
