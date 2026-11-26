// The cell-selection statistics the status bar shows (lib/selectionStats.ts).
// A tiny standalone store, like store/toasts: the worksheet pane publishes the
// result of its selection and the status bar reads it, with no coupling to the
// main app store. `owner` is the publishing grid, so a pane that unmounts or
// clears its selection never wipes a different pane's readout.

import { create } from "zustand";

import type { SelectionStats } from "../lib/selectionStats";

interface SelectionStatsState {
  owner: string | null;
  stats: SelectionStats | null;
  /** Publish `stats` for `owner`; null clears it, but only if `owner` still holds it. */
  publish: (owner: string, stats: SelectionStats | null) => void;
}

export const useSelectionStats = create<SelectionStatsState>((set, get) => ({
  owner: null,
  stats: null,
  publish: (owner, stats) => {
    if (stats === null) {
      if (get().owner === owner) set({ owner: null, stats: null });
    } else set({ owner, stats });
  },
}));
