// Outlier Screening workshop open state (JMP_GAP_PLAN J9 residual). A
// standalone store — the store/fitYByX.ts precedent — rather than a flag on
// useApp.ts: useApp sits at its size-ratchet pin (a new flag there would
// blow it), and panel visibility couples to nothing in the main app store.

import { create } from "zustand";
import type { OutlierScreeningRecipe } from "../lib/outlierScreeningAnalysisResult";

interface OutlierScreeningStoreState {
  open: boolean;
  request: OutlierScreeningRecipe | null;
  setOpen: (open: boolean) => void;
  openWith: (request: OutlierScreeningRecipe) => void;
  consumeRequest: () => void;
}

export const useOutlierScreeningStore = create<OutlierScreeningStoreState>((set) => ({
  open: false,
  request: null,
  setOpen: (open) => set({ open }),
  openWith: (request) => set({ open: true, request }),
  consumeRequest: () => set({ request: null }),
}));
