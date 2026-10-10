// Fit Y by X workbench open state (JMP_GAP_PLAN J3). A standalone store —
// the store/help.ts / store/toasts.ts precedent — rather than a flag on
// useApp.ts: useApp sits at its size-ratchet pin (a new flag there would
// blow it), and panel visibility couples to nothing in the main app store.

import { create } from "zustand";

import type { FitYByXRecipe } from "../lib/fitYByXAnalysisResult";

interface FitYByXState {
  open: boolean;
  request: FitYByXRecipe | null;
  setOpen: (open: boolean) => void;
  openWith: (request: FitYByXRecipe) => void;
  consumeRequest: () => void;
}

export const useFitYByXStore = create<FitYByXState>((set) => ({
  open: false,
  request: null,
  setOpen: (open) => set({ open }),
  openWith: (request) => set({ open: true, request }),
  consumeRequest: () => set({ request: null }),
}));
