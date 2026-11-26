// The previous session's autosave while it is HELD for the user's answer
// (lib/lateRestore.ts owns the workspace itself): what the welcome screen's
// "Restore last session" card shows. A standalone Zustand store, like
// store/recoveryChoice.ts, because it is transient UI state that never goes
// into a `.dwk` and useApp.ts has no size headroom. Only metadata lives here,
// never the workspace.

import { create } from "zustand";

export interface HeldSession {
  /** When that autosave was captured (epoch ms). */
  at: number;
  datasetCount: number;
  /** The first few dataset names, so the card says WHAT would come back. */
  names: string[];
  /** The previous session ended without a clean close. */
  crashed: boolean;
  /** Already appended once: only Replace or Discard remain (lib/lateRestore.ts). */
  appended: boolean;
}

export const useHeldRestore = create<{ held: HeldSession | null }>(() => ({ held: null }));
