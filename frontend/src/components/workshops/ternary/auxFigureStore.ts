// Open flags for the aux-figure workshops (ternary diagram, vector field,
// pie / doughnut chart). A standalone store — the store/variability.ts precedent — rather
// than two flags on useApp.ts, which sits at its size-ratchet pin. One tiny
// file for both so the eager bundle pays one zustand `create`, not two: it
// is the ONLY module from these workshop directories that eager code
// (commands/analysisCommands.ts, AppOverlayPanels.tsx) may import — see
// ternary/lazyMount.test.ts.

import { create } from "zustand";

import { setTernaryOpener } from "../../../lib/ternaryPending";
import type { TernaryKind } from "../../../lib/ternaryProject";

interface AuxFigureStoreState {
  ternaryOpen: boolean;
  fieldOpen: boolean;
  /** The pie / doughnut workshop (opened by an Origin pie apply; it closes
   *  itself with `setState`, so no setter rides the eager bundle). */
  pieOpen: boolean;
  /** A kind the gallery's "Ternary map" tile asks the workshop to switch to
   *  (taken and cleared by useTernary). */
  ternaryKindHint: TernaryKind | null;
  setTernaryOpen: (open: boolean, kind?: TernaryKind) => void;
  setFieldOpen: (open: boolean) => void;
}

export const useAuxFigureStore = create<AuxFigureStoreState>((set) => ({
  ternaryOpen: false,
  fieldOpen: false,
  pieOpen: false,
  ternaryKindHint: null,
  setTernaryOpen: (ternaryOpen, kind) => set({ ternaryOpen, ternaryKindHint: ternaryOpen ? (kind ?? null) : null }),
  setFieldOpen: (fieldOpen) => set({ fieldOpen }),
}));

// An applied Origin ternary / pie figure opens its workshop (lib/ternaryPending).
setTernaryOpener((flag) => useAuxFigureStore.setState({ [flag]: true }));
