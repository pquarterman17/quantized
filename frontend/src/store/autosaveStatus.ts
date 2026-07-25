// Autosave health (MAIN_PLAN #32). A standalone store — like store/toasts and
// store/commands — rather than a field on useApp.
//
// Two reasons, and the second is the load-bearing one:
//  1. It is not workspace state. It describes THIS session's storage, is never
//     serialized into a `.dwk`, and a stale value restored from one would be
//     actively misleading.
//  2. useApp is at its size ratchet. The ratchet's own failure message says
//     "extract another slice, do NOT raise the pin" — a value that no workspace
//     action reads has no business widening the composed store.
//
// Kept separate from `status` (the transient status line) on purpose: a failing
// autosave must stay visible until the next SUCCESS, and anything sharing the
// status line gets overwritten by the next operation.

import { create } from "zustand";

import { HEALTHY, type AutosaveHealth } from "../lib/autosaveGenerations";

interface AutosaveStatusState {
  health: AutosaveHealth;
  setHealth: (health: AutosaveHealth) => void;
}

export const useAutosaveStatus = create<AutosaveStatusState>((set) => ({
  health: HEALTHY,
  setHealth: (health) => set({ health }),
}));

/** Imperative setter for non-React call sites (the autosave hook). */
export function reportAutosaveHealth(health: AutosaveHealth): void {
  useAutosaveStatus.getState().setHealth(health);
}
