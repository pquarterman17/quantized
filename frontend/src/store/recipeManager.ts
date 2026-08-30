// Recipe Manager panel open/closed handshake (P1.3 wave 3, Lane D). A
// STANDALONE Zustand store -- the store/recode.ts / store/relink.ts
// precedent -- rather than a useApp.ts boolean field: this is pure UI
// open/closed state (never persisted, never undoable), and useApp.ts's
// size-ratchet pin (architecture.test.ts's STORE_PINS) has no headroom to
// spend on a field that would only ever be read/written by this one panel.

import { create } from "zustand";

interface RecipeManagerState {
  open: boolean;
  library: boolean;
  openRecipeManager: () => void;
  closeRecipeManager: () => void;
  openRecipeLibrary: () => void;
}

export const useRecipeManager = create<RecipeManagerState>((set) => ({
  open: false,
  library: true,
  openRecipeManager: () => set({ open: true, library: false }),
  closeRecipeManager: () => set({ open: false }),
  openRecipeLibrary: () => set({ open: true, library: true }),
}));
