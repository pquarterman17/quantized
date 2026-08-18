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
  /** Review-round fix (P2b): set instead of `datasetId` when the workbook
   *  menu opens the chooser for a workbook with ZERO current worksheet
   *  children -- there is no dataset to resolve against, but its
   *  workbook-scoped templates must still be reachable to rename/delete
   *  (the manage affordance must not be scope-hostage to "has a worksheet
   *  right now"). `datasetId` and `workbookId` are mutually exclusive. */
  workbookId: string | null;
  open: (datasetId: string) => void;
  openForWorkbook: (workbookId: string) => void;
  close: () => void;
}

export const useQuickPlotWithDialog = create<QuickPlotWithDialogState>((set) => ({
  datasetId: null,
  workbookId: null,
  open: (datasetId) => set({ datasetId, workbookId: null }),
  openForWorkbook: (workbookId) => set({ datasetId: null, workbookId }),
  close: () => set({ datasetId: null, workbookId: null }),
}));

/** Open the "Quick Plot With..." chooser for `datasetId`. */
export function openQuickPlotWith(datasetId: string): void {
  useQuickPlotWithDialog.getState().open(datasetId);
}

/** Open the chooser in workbook-only mode (no worksheet to target yet) --
 *  see `workbookId`'s doc above. */
export function openQuickPlotWithForWorkbook(workbookId: string): void {
  useQuickPlotWithDialog.getState().openForWorkbook(workbookId);
}
