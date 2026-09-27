// The SIMS depth-profile workshop's open/closed handshake (audit P2.3). A
// tiny standalone zustand store — the `store/resampleDialog.ts` shape: pure
// UI-open state, no `.dwk` hook-in, no history entry, and ZERO lines in
// useApp.ts (which sits at its size-ratchet pin). `AppOverlays.tsx` reads the
// flag to decide whether to mount the LAZY workshop chunk without importing
// the chunk itself.
//
// `seed` is the dataset id the workshop opens on (the active dataset, else
// the first selected); `opened` counts openings so running the command again
// re-seeds the workshop instead of silently keeping the old pick.

import { create } from "zustand";

interface SimsDialogState {
  /** Non-null while the workshop is open ("" = open with no dataset). */
  seed: string | null;
  opened: number;
  open: (seed: string) => void;
  close: () => void;
}

export const useSimsDialog = create<SimsDialogState>((set) => ({
  seed: null,
  opened: 0,
  open: (seed) => set((s) => ({ seed, opened: s.opened + 1 })),
  close: () => set({ seed: null }),
}));

/** Open the SIMS workshop on dataset `id`. */
export function openSimsDialog(id: string): void {
  useSimsDialog.getState().open(id);
}
