// Outlier Screening workshop open state (JMP_GAP_PLAN J9 residual). A
// standalone store — the store/fitYByX.ts precedent — rather than a flag on
// useApp.ts: useApp sits at its size-ratchet pin (a new flag there would
// blow it), and panel visibility couples to nothing in the main app store.

import { create } from "zustand";

interface OutlierScreeningStoreState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useOutlierScreeningStore = create<OutlierScreeningStoreState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
