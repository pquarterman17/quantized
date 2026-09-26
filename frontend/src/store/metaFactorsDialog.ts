// The "Metadata → factors" workshop's open flag (audit P2.5). Same shape as
// store/resampleDialog.ts: pure UI-open state, zero lines in useApp.ts;
// AppOverlays mounts the LAZY workshop while `seed` is set. `opened` counts
// openings so a second open re-seeds the workshop.

import { create } from "zustand";

export const useMetaFactorsDialog = create<{ seed: string[] | null; opened: number }>(() => ({ seed: null, opened: 0 }));

/** Open on `ids` (the Library selection, else the active dataset). */
export const openMetaFactors = (ids: readonly string[]): void =>
  useMetaFactorsDialog.setState((s) => ({ seed: [...ids], opened: s.opened + 1 }));
