// "Open in tool" from the Recipe Library hands a preset to a workshop that may
// not be mounted yet (plans/PRESET_BAR_CONTRACT.md P8). The preset bar of that
// workshop takes it when it appears (or at once if it is already open) and
// loads the DRAFT only: nothing here runs a tool. Session state, one slot;
// a handoff nobody took within a couple of minutes is stale and ignored.

import { create } from "zustand";

export interface PendingPreset {
  workshop: string;
  id: string;
  at: number;
}

export const PENDING_PRESET_TTL_MS = 2 * 60 * 1000;

interface State {
  pending: PendingPreset | null;
  hand: (workshop: string, id: string) => void;
  clear: () => void;
}

export const usePendingPreset = create<State>((set) => ({
  pending: null,
  hand: (workshop, id) => set({ pending: { workshop, id, at: Date.now() } }),
  clear: () => set({ pending: null }),
}));

/** True when `pending` is for `workshop` and still fresh. */
export const isLivePending = (pending: PendingPreset | null, workshop: string): pending is PendingPreset =>
  pending !== null && pending.workshop === workshop && Date.now() - pending.at <= PENDING_PRESET_TTL_MS;
