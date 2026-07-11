// The Reductions workshop's open/method slice (MAIN_PLAN #11), composed into
// the ONE useApp store instance exactly like ./windows and ./history (read
// windows.ts's header first): useApp spreads `createReductionsSlice(set)` in,
// so every existing `useApp((s) => ...)` selector keeps working — this file
// is a code boundary, not a second store. Kept tiny (open flag + which-method
// picker) so appCommands.ts's three Analyze entries ("Williamson-Hall…",
// "Film thickness (FFT)…", "Reflectivity FFT…") can open the SAME ToolWindow
// pre-set to their method via one `openReductions(method)` action, without
// growing useApp.ts past its store-size ratchet pin.

import type { AppState } from "./useApp";

export type ReductionsMethod = "williamson-hall" | "fft-thickness" | "reflectivity-fft";

export interface ReductionsSlice {
  reductionsOpen: boolean;
  reductionsMethod: ReductionsMethod;
  /** Open the workshop pre-set to `method` (the Analyze-menu entries). */
  openReductions: (method: ReductionsMethod) => void;
  setReductionsOpen: (open: boolean) => void;
  setReductionsMethod: (method: ReductionsMethod) => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export function createReductionsSlice(set: SliceSet): ReductionsSlice {
  return {
    reductionsOpen: false,
    reductionsMethod: "williamson-hall",
    openReductions: (method) => set({ reductionsOpen: true, reductionsMethod: method }),
    setReductionsOpen: (reductionsOpen) => set({ reductionsOpen }),
    setReductionsMethod: (reductionsMethod) => set({ reductionsMethod }),
  };
}
