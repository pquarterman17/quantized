// The Resample / align workshop's open/closed handshake (audit P2.5). A tiny,
// standalone zustand store — the same shape as `store/combineDialog.ts` (see
// that header): pure UI-open state, no `.dwk` hook-in, no history entry, and
// ZERO lines in useApp.ts. `AppOverlays.tsx` reads the flag to decide whether
// to mount the LAZY workshop chunk without importing the chunk itself.
//
// `seed` is the dataset ids the workshop opens with (the Library selection,
// else the active dataset); the workshop lets the user change the pick.
// `opened` counts openings: running the command again while the workshop is
// open re-seeds it (the panel remounts on a new count) instead of silently
// keeping the old pick.

import { create } from "zustand";

interface ResampleDialogState {
  /** Non-null while the workshop is open. */
  seed: string[] | null;
  opened: number;
  open: (seed: string[]) => void;
  close: () => void;
}

export const useResampleDialog = create<ResampleDialogState>((set) => ({
  seed: null,
  opened: 0,
  open: (seed) => set((s) => ({ seed, opened: s.opened + 1 })),
  close: () => set({ seed: null }),
}));

/** Open the Resample / align workshop on `ids` (in order). */
export function openResampleDialog(ids: readonly string[]): void {
  useResampleDialog.getState().open([...ids]);
}
