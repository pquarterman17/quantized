// Fit Model workshop open state (GAP_AUDIT_9 G1). A standalone store, the
// store/variability.ts precedent: useApp sits at its size-ratchet pin, and
// panel visibility couples to nothing in the main app store. `request` is a
// saved result's recipe handed back by "Edit / rerun" in the Library.

import { create } from "zustand";
import type { FitModelRecipe } from "../lib/fitModelRecipe";

interface FitModelStoreState {
  open: boolean;
  request: FitModelRecipe | null;
  setOpen: (open: boolean) => void;
  openWith: (request: FitModelRecipe) => void;
  consumeRequest: () => void;
}

export const useFitModelStore = create<FitModelStoreState>((set) => ({
  open: false,
  request: null,
  setOpen: (open) => set({ open }),
  openWith: (request) => set({ open: true, request }),
  consumeRequest: () => set({ request: null }),
}));
