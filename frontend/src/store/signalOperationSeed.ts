// The "open Signal Processing on THIS operation" handshake behind the ⌘K
// deep-link commands (Normalize · peak = 1, Derivative, Integrate, ...). A
// tiny standalone store, the `store/simsDialog.ts` shape: no `.dwk` hook-in,
// no history entry, ZERO lines in the eager stores. The command sets the
// request and opens the panel; the (lazy) panel applies it once on mount, or
// at once when it is already open, then clears it so a later plain open keeps
// whatever operation was last chosen.

import { create } from "zustand";

interface SignalOperationSeedState {
  /** Operation value to preselect (a `SignalOperation` or sigop method id). */
  op: string | null;
  /** Counts requests so asking for the same operation twice still re-applies. */
  nonce: number;
  /** When it was requested; a request nobody consumed in `SEED_TTL_MS` is stale. */
  at: number;
  request: (op: string) => void;
  clear: () => void;
}

/** A seed the panel never consumed (its lazy chunk failed to load) must not
 *  surface minutes later on an unrelated open. */
export const SEED_TTL_MS = 60_000;

export const useSignalOperationSeed = create<SignalOperationSeedState>((set) => ({
  op: null,
  nonce: 0,
  at: 0,
  request: (op) => set((s) => ({ op, nonce: s.nonce + 1, at: Date.now() })),
  clear: () => set({ op: null }),
}));
