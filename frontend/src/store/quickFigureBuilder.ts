// Transient launch state for the Quick Figure Builder (LIBRARY_WORKBOOK_UX
// plan PR G). The builder edits a local draft; this slice stores the source
// worksheet identity plus an optional caller-provided draft seed. Opening or
// cancelling therefore cannot mutate raw data, figures, templates, selection,
// or the surface underneath.

import type { AppState } from "./useApp";
import type { QuickFigureMapping } from "../lib/quickFigureMapping";
import type { FigureOverlays } from "../lib/figureOverlays";

type SliceSet = (partial: Partial<AppState>) => void;

export interface QuickFigureBuilderSlice {
  quickFigureBuilderDatasetId: string | null;
  /** Optional caller-provided starting assignments. This is transient draft
   * state, not a saved template or a mutation of the worksheet. */
  quickFigureBuilderSeed: QuickFigureMapping | null;
  /** Gap audit 5 lane C: a saved result's fit curve the created figure keeps
   *  (Analysis Results' Build source figure), row-aligned to this worksheet.
   *  Handed to the new figure only -- the canvas' fit slot is never touched. */
  quickFigureBuilderOverlays: FigureOverlays | null;
  openQuickFigureBuilder: (datasetId: string, seed?: QuickFigureMapping, overlays?: FigureOverlays) => boolean;
  closeQuickFigureBuilder: () => void;
}

export function createQuickFigureBuilderSlice(set: SliceSet, get: () => AppState): QuickFigureBuilderSlice {
  return {
    quickFigureBuilderDatasetId: null,
    quickFigureBuilderSeed: null,
    quickFigureBuilderOverlays: null,
    openQuickFigureBuilder: (datasetId, seed, overlays) => {
      if (!get().datasets.some((dataset) => dataset.id === datasetId)) {
        set({ status: "Quick Figure Builder unavailable: worksheet not found" });
        return false;
      }
      set({
        quickFigureBuilderDatasetId: datasetId,
        quickFigureBuilderOverlays: overlays ?? null,
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
    closeQuickFigureBuilder: () => set({ quickFigureBuilderDatasetId: null, quickFigureBuilderSeed: null, quickFigureBuilderOverlays: null }),
  };
}
