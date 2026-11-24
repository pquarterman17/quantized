// Design of experiments workshop open state (GAP_AUDIT_9 J16). A standalone
// store, the store/fitModel.ts precedent: useApp sits at its size-ratchet pin.

import { create } from "zustand";

interface DoeStoreState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useDoeStore = create<DoeStoreState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
