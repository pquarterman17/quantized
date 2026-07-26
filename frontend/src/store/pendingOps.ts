// Pending-operations tracker (P3.4 slice 2, 2026-07-26 audit gap #2): the
// shared "something async is running" primitive. Any async command
// registers itself here for its duration; StatusBar renders a busy
// indicator for anything still registered past its own age-gate, so a slow
// operation is never silently invisible between "user clicked" and the
// eventual completion/failure toast — the gap the audit's #2 finding named
// (CommandPalette firing `a.run()` with zero in-flight signal).
//
// A standalone store — like store/toasts, store/commands, store/
// autosaveStatus — rather than a field on useApp. Two reasons:
//  1. useApp.ts is at its size-ratchet ceiling (architecture.test.ts's
//     STORE_PINS, zero headroom) — this must not touch it.
//  2. In-flight ops are pure runtime/session state: never persisted, never
//     serialized into a `.dwk`, and a stale value restored from one would be
//     actively misleading (same reasoning as autosaveStatus.ts).
//
// Public contract — this is the shared primitive the P3.4 slice 1
// (import cancel) and slice 3 (workspace open) follow-up slices will also
// register through, so keep the surface small and generic:
//   beginOp(label) -> OpId   register one in-flight operation
//   endOp(id)                unregister it (a no-op for an unknown/already-
//                            gone id, so a late/duplicate call is harmless)
//   withOp(label, fn)        wrap an async fn: begins before calling it,
//                            ends in a `finally` (covers BOTH resolve and
//                            reject), and rethrows on rejection — callers
//                            keep their own try/catch/error-reporting
//                            exactly as before; this only wraps it.
//   usePendingOps            the zustand hook — `.ops` is oldest-first.
// Do not add feature-specific fields to `PendingOp` — label + timestamp is
// the whole contract every consumer shares.

import { create } from "zustand";

export type OpId = number;

export interface PendingOp {
  id: OpId;
  label: string;
  startedAt: number;
}

interface PendingOpsState {
  /** Oldest-first — a consumer showing "N more" wants a stable head. */
  ops: PendingOp[];
}

let seq = 0;

export const usePendingOps = create<PendingOpsState>(() => ({ ops: [] }));

/** Register one in-flight operation. Returns its id — pass it to `endOp`. */
export function beginOp(label: string): OpId {
  const id = ++seq;
  usePendingOps.setState((s) => ({
    ops: [...s.ops, { id, label, startedAt: Date.now() }],
  }));
  return id;
}

/** Unregister an operation. Safe to call with an id that's already gone
 *  (e.g. a duplicate cleanup path) — filtering a missing id is a no-op. */
export function endOp(id: OpId): void {
  usePendingOps.setState((s) => ({ ops: s.ops.filter((o) => o.id !== id) }));
}

/** Wrap an async function: registers before calling it, unregisters in a
 *  `finally` (resolve OR reject), and rethrows on rejection so a caller's
 *  own error handling is unaffected — this only adds the in-flight signal
 *  around whatever the function already does. */
export async function withOp<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const id = beginOp(label);
  try {
    return await fn();
  } finally {
    endOp(id);
  }
}
