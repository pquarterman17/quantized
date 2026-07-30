// Fit Y by X workbench open state (JMP_GAP_PLAN J3). A standalone store —
// the store/help.ts / store/toasts.ts precedent — rather than a flag on
// useApp.ts: useApp sits at its size-ratchet pin (a new flag there would
// blow it), and panel visibility couples to nothing in the main app store.

import { create } from "zustand";

interface FitYByXState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useFitYByXStore = create<FitYByXState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
