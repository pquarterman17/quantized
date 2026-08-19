// The Combine dialog's open/closed handshake (LIBRARY_WORKBOOK_UX_PLAN PR J
// slice 2 — L0.32-L0.34's UI). A tiny, standalone zustand store — the SAME
// shape as `store/quickPlotWithDialog.ts` (see that file's header for the
// reasoning): pure UI-open state (which selection the dialog was invoked
// with), not persistent project data, so it needs no `.dwk` hook-in and no
// HistorySnapshot/HISTORY_EXCLUDED entry (its interface is deliberately NOT
// named `*Slice` — architecture.test.ts's coverage guard only scans
// `export interface *Slice`/`AppState` blocks, the same reason
// `QuickPlotWithDialogState` is exempt). Kept out of `useApp` entirely so
// `AppOverlays.tsx` can read the open flag to decide whether to mount the
// LAZY dialog chunk without importing the chunk itself, and so this PR adds
// ZERO lines to useApp.ts for the dialog's own open state.
//
// The SEED is a `CombineSelection` (lib/workbookCombine.ts) — the initial
// choice made by the invoking gesture (a workbook's "Combine…" context menu
// entry, or a multi-selected group of worksheets). The dialog itself
// resolves the seed to its flat worksheet list once, on open
// (`resolveCombineTargets`), and only lets the user narrow it further
// (uncheck items) — "choose/confirm the selection" (L0.32's UI brief), never
// widen it to arbitrary other Library items the invoking gesture never named.

import { create } from "zustand";

import type { CombineSelection } from "../lib/workbookCombine";

interface CombineDialogState {
  /** Non-null while the dialog is open; the selection it was invoked with. */
  seed: CombineSelection | null;
  open: (seed: CombineSelection) => void;
  close: () => void;
}

export const useCombineDialog = create<CombineDialogState>((set) => ({
  seed: null,
  open: (seed) => set({ seed }),
  close: () => set({ seed: null }),
}));

/** Open the Combine dialog seeded with `selection` (whole workbooks and/or
 *  individually picked worksheets — see `lib/workbookCombine.ts`'s
 *  `CombineSelection`). */
export function openCombineDialog(selection: CombineSelection): void {
  useCombineDialog.getState().open(selection);
}
