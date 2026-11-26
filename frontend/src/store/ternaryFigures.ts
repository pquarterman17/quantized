// Live per-dataset ternary-workshop settings (lib/ternaryProject.ts has the
// file form and the persistence rules). A standalone store — the
// auxFigureStore / store/variability.ts precedent — so useApp.ts, which sits
// at its size pin, is untouched. Written only by a user choice in the
// workshop (never by default derivation), read at save through
// `lib/workspaceSerialize.ts` and filled at open by
// `store/workspaceHydration.ts` (lazily: eager code never imports this).

import { create } from "zustand";

import type { TernaryFiguresMap, TernarySaved } from "../lib/ternaryProject";

interface TernaryFiguresState {
  byDataset: TernaryFiguresMap;
  save: (datasetId: string, saved: TernarySaved) => void;
  /** Merge opened/appended project settings (a re-opened dataset id wins). */
  adopt: (incoming: TernaryFiguresMap) => void;
}

export const useTernaryFigures = create<TernaryFiguresState>((set) => ({
  byDataset: {},
  save: (datasetId, saved) => set((s) => ({ byDataset: { ...s.byDataset, [datasetId]: saved } })),
  adopt: (incoming) => set((s) => ({ byDataset: { ...s.byDataset, ...incoming } })),
}));
