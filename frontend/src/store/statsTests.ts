// Statistical tests workshop open state. A standalone store (the
// store/multivar.ts precedent) rather than a flag on useApp.ts, which sits at
// its size-ratchet pin.

import { create } from "zustand";

interface StatsTestsStoreState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useStatsTestsStore = create<StatsTestsStoreState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
