// Open flags for the two aux-figure workshops (ternary diagram, vector
// field). A standalone store — the store/variability.ts precedent — rather
// than two flags on useApp.ts, which sits at its size-ratchet pin. One tiny
// file for both so the eager bundle pays one zustand `create`, not two: it
// is the ONLY module from these workshop directories that eager code
// (commands/analysisCommands.ts, AppOverlays.tsx) may import — see
// ternary/lazyMount.test.ts.

import { create } from "zustand";

interface AuxFigureStoreState {
  ternaryOpen: boolean;
  fieldOpen: boolean;
  setTernaryOpen: (open: boolean) => void;
  setFieldOpen: (open: boolean) => void;
}

export const useAuxFigureStore = create<AuxFigureStoreState>((set) => ({
  ternaryOpen: false,
  fieldOpen: false,
  setTernaryOpen: (ternaryOpen) => set({ ternaryOpen }),
  setFieldOpen: (fieldOpen) => set({ fieldOpen }),
}));
