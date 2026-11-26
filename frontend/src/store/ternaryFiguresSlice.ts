// The ternary workshop's per-dataset settings as a composed store slice (plan
// item 21; file form and persistence rules in lib/ternaryProject.ts). A slice of
// useApp, like store/libraryDetailsColumns.ts, so the shared autosave trigger
// sees it: any change marks the project dirty and schedules an autosave
// (store/autosaveTrigger.ts), which a standalone store could not do.
//
// Not undoable (a view preference, architecture.test.ts HISTORY_EXCLUDED).
// Written only by a user choice in the workshop, never by default derivation.

import type { TernaryFiguresMap, TernarySaved } from "../lib/ternaryProject";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export interface TernaryFiguresSlice {
  /** Per-dataset ternary settings the user chose; empty = nothing to save. */
  ternaryFigures: TernaryFiguresMap;
  saveTernaryFigure: (datasetId: string, saved: TernarySaved) => void;
}

export function createTernaryFiguresSlice(set: SliceSet): TernaryFiguresSlice {
  return {
    ternaryFigures: {},
    saveTernaryFigure: (datasetId, saved) => set((s) => ({ ternaryFigures: { ...s.ternaryFigures, [datasetId]: saved } })),
  };
}
