// The "Quick Plot With..." chooser's open/closed handshake (plan PR H5b,
// L0.36-L0.38's menu action). A tiny, standalone zustand store — same shape
// as `components/overlays/ParamDialog.tsx`'s own local `useParamDialog` --
// kept OUT of `useApp` deliberately: it is pure UI-open state (which
// dataset the chooser targets), not persistent project data, so it needs no
// `.dwk` hook-in and no HistorySnapshot entry (see `store/history.ts`'s
// exclusion discipline -- this is the same class as `revealTarget`). Split
// into its own tiny module (rather than living inside the dialog component
// file) so `AppOverlays.tsx` can read the open flag to decide whether to
// mount the LAZY dialog chunk without importing the chunk itself.

import { create } from "zustand";

interface QuickPlotWithDialogState {
  datasetId: string | null;
  open: (datasetId: string) => void;
  close: () => void;
}

export const useQuickPlotWithDialog = create<QuickPlotWithDialogState>((set) => ({
  datasetId: null,
  open: (datasetId) => set({ datasetId }),
  close: () => set({ datasetId: null }),
}));

/** Open the "Quick Plot With..." chooser for `datasetId`. */
export function openQuickPlotWith(datasetId: string): void {
  useQuickPlotWithDialog.getState().open(datasetId);
}
