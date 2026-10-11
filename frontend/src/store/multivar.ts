// Multivariate workbench open state (JMP_GAP_PLAN J10). A standalone store —
// the store/help.ts / store/fitYByX.ts precedent — rather than a flag on
// useApp.ts: useApp sits at its size-ratchet pin (a new flag there would
// blow it), and panel visibility couples to nothing in the main app store.

import { create } from "zustand";
import type { MultivariateRecipe } from "../lib/multivariateAnalysisResult";

interface MultivarPanelState {
  open: boolean;
  request: MultivariateRecipe | null;
  setOpen: (open: boolean) => void;
  openWith: (request: MultivariateRecipe) => void;
  consumeRequest: () => void;
}

export const useMultivarStore = create<MultivarPanelState>((set) => ({
  open: false,
  request: null,
  setOpen: (open) => set({ open }),
  openWith: (request) => set({ open: true, request }),
  consumeRequest: () => set({ request: null }),
}));
