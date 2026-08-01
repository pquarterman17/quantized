// Variability chart workshop open state (JMP_GAP_PLAN J8 UI). A standalone
// store — the store/multivar.ts / store/outlierScreening.ts precedent —
// rather than a flag on useApp.ts: useApp sits at its size-ratchet pin (a
// new flag there would blow it), and panel visibility couples to nothing in
// the main app store.

import { create } from "zustand";

interface VariabilityStoreState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useVariabilityStore = create<VariabilityStoreState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
