// Autosave generation bookkeeping (MAIN_PLAN #32) — the PURE half.
//
// Autosave used to be one localStorage slot: a single generation, overwritten
// in place, on a store whose own header warned that a large library "can exceed
// the ~5 MB quota". That is one bad write away from losing the work, and it
// gives a user nothing to fall back TO. This module owns the rules for keeping
// several rotating generations and picking which one to restore.
//
// It is deliberately storage-agnostic and side-effect free: every decision that
// can be wrong is testable without IndexedDB, which jsdom does not implement.
// The adapter that actually touches a browser store lives in
// ./autosaveBackend.ts and is kept as thin as possible for that reason.

/** One saved snapshot: the serialized `.dwk` text plus when it was written. */
export interface Generation {
  /** Epoch ms. Supplied by the caller — this module never reads the clock, so
   *  its behaviour is reproducible in tests. */
  at: number;
  /** `serializeWorkspace` output. */
  text: string;
}

// The rotation, age and size rules live in ./autosaveGenerationRules.ts
// (bundle diet slice 32), re-exported here so every importer is unchanged: only
// the lazy autosave engine (./autosaveCore.ts) and the tests call them.
export * from "./autosaveGenerationRules";

/** Autosave health, surfaced in the UI so a failing save is visible rather than
 *  a status line that scrolls away (#32: the old code DID warn, but only once
 *  and only transiently). */
export interface AutosaveHealth {
  /** Epoch ms of the last successful write; null = nothing saved yet. */
  savedAt: number | null;
  /** Why the last attempt failed; null = healthy. Persisting until the next
   *  SUCCESS is the point — this is the "actionable error" the plan asks for. */
  error: string | null;
  /** Generations currently retained. */
  count: number;
  /** The previous session's library is not back yet (a startup restore that
   *  could not load, or a recovered one awaiting Append/Replace/Discard) —
   *  its generations are pinned meanwhile. Absent = nothing pending. */
  restoreError?: string | null;
  /** With `restoreError`: the previous session was appended and its full
   *  copy is kept for a Replace or Discard (the label says "kept"). */
  restoreKept?: boolean;
  /** Saves are deliberately paused, not failing (another tab holds the
   *  browser autosave slot, or this session was opened as a copy): the
   *  message to show. Cleared by the next real save outcome. */
  paused?: string | null;
}

export const HEALTHY: AutosaveHealth = { savedAt: null, error: null, count: 0 };
