// Pending crash-recovery prompt (P1.2 box 5) — a standalone Zustand store,
// like store/autosaveStatus.ts and store/recentProjects.ts, and for the same
// reason: this is session-transient UI state (never serialized into a
// `.dwk`, meaningless to restore from one) that useApp.ts's size ratchet
// (architecture.test.ts's STORE_PINS) has no room for anyway.
//
// Holds the ACTUAL parsed workspace candidate (not just its metadata) so the
// dialog's "Recover" choice has something to hand straight to
// `loadWorkspace` — useWorkspaceAutosave.ts fetches it once via
// `loadAutosaveGeneration()` and stores the result here rather than
// re-fetching on the user's choice.

import { create } from "zustand";

import type { LastProjectRef } from "../lib/recoveryChoice";
import type { LoadedWorkspace } from "../lib/workspace";

export interface RecoveryPrompt {
  /** The autosave candidate, already parsed and ready to load. */
  workspace: LoadedWorkspace;
  /** When that candidate was captured (epoch ms) — shown as SOURCE=Autosave. */
  autosaveAt: number;
  /** How many datasets the candidate holds — for the dialog's summary line. */
  datasetCount: number;
  /** What the dialog is comparing against — shown as SOURCE=<name>. */
  lastProject: LastProjectRef;
}

interface RecoveryChoiceState {
  pending: RecoveryPrompt | null;
  offerRecovery: (prompt: RecoveryPrompt) => void;
  clearRecovery: () => void;
}

export const useRecoveryChoice = create<RecoveryChoiceState>((set) => ({
  pending: null,
  offerRecovery: (prompt) => set({ pending: prompt }),
  clearRecovery: () => set({ pending: null }),
}));
