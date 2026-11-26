// The cell-selection statistics the status bar shows (lib/selectionStats.ts).
// A tiny standalone store, like store/toasts: the worksheet pane publishes the
// result of its selection and the status bar reads it, with no coupling to the
// main app store. `owner` is the publishing grid, so a pane that unmounts or
// clears its selection never wipes a different pane's readout.

import { create } from "zustand";

interface SelectionStatsState {
  owner: string | null;
  /** The formatted status-bar line (lib/selectionStats.formatSelectionStats), formatted
   *  by the publisher so the eager status bar carries no number-formatting code. */
  text: string | null;
  /** Publish `text` for `owner`; null clears it, but only if `owner` still holds it. */
  publish: (owner: string, text: string | null) => void;
}

export const useSelectionStats = create<SelectionStatsState>((set, get) => ({
  owner: null,
  text: null,
  publish: (owner, text) => {
    if (text === null) {
      if (get().owner === owner) set({ owner: null, text: null });
    } else set({ owner, text });
  },
}));
