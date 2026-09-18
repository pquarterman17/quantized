// Transient toast notifications (design interaction layer). A standalone store
// (like store/commands) so any call site — store actions, handlers, components —
// can confirm an action fired without coupling to the main app store or causing
// its subscribers to re-render. The StatusBar remains the persistent status line;
// toasts are the fleeting "it happened" confirmations.

import { create } from "zustand";

export type ToastKind = "info" | "ok" | "danger";

/** An inline action a toast can offer (PLOT_WORKFLOW_PLAN #4 batch-overlay
 *  offer is the first caller) — kept generic rather than named for that one
 *  feature, since any future "here's what just happened, want to do the
 *  obvious next thing?" notification can reuse it instead of growing a
 *  parallel confirm-toast mechanism. Clicking it both fires `onClick` and
 *  dismisses the toast (Toaster.tsx); NOT clicking it is a legitimate
 *  decline — the toast still auto-dismisses like any other. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  msg: string;
  kind: ToastKind;
  action?: ToastAction;
}

/** Optional extras beyond message + kind. `ttlMs` overrides the default
 *  auto-dismiss timer — an action toast asks the user to read and decide,
 *  not just glance, so callers offering one should pass `TOAST_ACTION_TTL`. */
export interface ToastOptions {
  action?: ToastAction;
  ttlMs?: number;
}

interface ToastsState {
  toasts: Toast[];
  push: (msg: string, kind?: ToastKind, opts?: ToastOptions) => void;
  dismiss: (id: number) => void;
}

/** P3.4 diagnostics — three monotonic, content-free counters, incremented
 *  once per `push` and never trimmed.
 *
 *  WHAT IS DELIBERATELY NOT RECORDED: the message text. "Recent errors" is on
 *  P3.4's diagnostic-bundle wish list, and the obvious implementation — keep
 *  the last N `msg` strings — would quietly undo the one promise the bundle
 *  makes. Toast text in this app routinely embeds exactly what the bundle
 *  withholds: a dataset name (`re-import "<name>" failed`), a column label
 *  (`"<label>" isn't categorical`), an absolute source path
 *  (`source unavailable — "<name>" (<path>)`) and a file basename. Recording
 *  those, even in a bounded ring, would be a ring of unpublished sample
 *  names pasted into a public issue.
 *
 *  Fix (2026-09-14 review round): this used to be a bounded `{kind, at}[]`
 *  ring (`MARKS_MAX = 50`) with "errors" and "last error" DERIVED from
 *  whichever entries survived the trim. A ring is a window, not a total —
 *  fifty `"ok"`/`"info"` toasts after one `"danger"` evicted it, so a session
 *  that had just had an error reported `errors 0` / `last error never`, and
 *  a burst of 500 toasts reported `total 50` with no way to tell "exactly
 *  50" from "500, 449 evicted". These three counters cannot be evicted: each
 *  is incremented once per push and never trimmed, so the bundle reports the
 *  true session totals, not a sample of them.
 *
 *  The kind and the time still answer the triage question the bundle is for
 *  — "were errors firing when this happened, and how recently?" — and cannot
 *  leak, by construction rather than by review: no message text, no ring of
 *  history to grow unboundedly, just three numbers. The text itself stays
 *  where the user can read it and choose to quote it: the toast and the
 *  status line.
 */

// Module-level rather than zustand state on purpose: nothing renders from it
// (a subscriber would re-render on every toast for no visual reason), and the
// one consumer — store/diagnostics.ts — reads it imperatively when the user
// asks for a bundle.
let totalCount = 0;
let errorCount = 0;
/** Epoch ms of the most recent `"danger"` push this session, or null if none
 *  has fired yet. Rendered as an age, never as a wall-clock time. */
let lastErrorAt: number | null = null;

export function notificationCounts(): {
  totalCount: number;
  errorCount: number;
  lastErrorAt: number | null;
} {
  return { totalCount, errorCount, lastErrorAt };
}

/** Test seam — the counters are module state, so they outlive a store reset. */
export function resetNotificationCountsForTests(): void {
  totalCount = 0;
  errorCount = 0;
  lastErrorAt = null;
}

// Monotonic id (no Date.now/Math.random → deterministic in tests).
let seq = 0;
/** How long a toast lingers before auto-dismiss. */
export const TOAST_TTL = 1900;
/** Longer auto-dismiss for a toast carrying an action button — deciding
 *  whether to click takes longer than reading a plain status confirmation. */
export const TOAST_ACTION_TTL = 6000;
/** Cap concurrent toasts so a burst can't cover the screen. */
const MAX = 4;

export const useToasts = create<ToastsState>((set, get) => ({
  toasts: [],
  push: (msg, kind = "info", opts) => {
    const id = ++seq;
    totalCount += 1;
    if (kind === "danger") {
      errorCount += 1;
      lastErrorAt = Date.now();
    }
    set((s) => ({
      toasts: [...s.toasts, { id, msg, kind, action: opts?.action }].slice(-MAX),
    }));
    setTimeout(() => get().dismiss(id), opts?.ttlMs ?? TOAST_TTL);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helper for non-component call sites (store actions, callbacks). */
export function toast(msg: string, kind?: ToastKind, opts?: ToastOptions): void {
  useToasts.getState().push(msg, kind, opts);
}

/** BUG-010: fire ONE toast summarizing `warnings` (a load/merge path's
 *  `migrationWarnings` — a skipped/degraded field from an older or
 *  unsupported saved document) — the first warning's text plus a "(+N more)"
 *  count, never one toast per warning. No-op when empty, so every load/merge
 *  call site can call this unconditionally. Lives here (not a separate lib
 *  module) because every call site already imports `toast` from this exact
 *  module — one shared helper with no new module edge to pay for. See
 *  BUGS_AND_ISSUES.md's BUG-010 entry for why `useApp.ts`'s own
 *  `migrationNotice` status-line fold (File ▸ Open only) isn't enough.
 *
 *  Review round (BUG-010 fix review): on two call sites (`applyRecoveryChoice
 *  .ts`'s `applyRecoverAutosave`, `useWorkspaceAutosave.ts`'s silent restore)
 *  a later `setStatus` deliberately overwrites `loadWorkspace`'s own
 *  migration-notice status-line fold, so this toast is the ONLY surface
 *  "part of your saved document was dropped" gets there — worth more than a
 *  glance-length confirmation. `ToastKind` has no dedicated "warning" value
 *  (`"info" | "ok" | "danger"`, above), so this keeps `"info"` — the SAME
 *  kind `useWorkspaceAutosave.ts`'s "Recovered … check your latest edits"
 *  toast already uses for an analogous "something was silently changed, go
 *  look" notice, rather than reaching for `"danger"` (reserved for an
 *  operation that failed outright; a migration warning is a successful load
 *  that dropped one degraded piece, not a failure) — and upgrades the
 *  lifetime from the default `TOAST_TTL` to `TOAST_ACTION_TTL` (6 s instead
 *  of 1.9 s) so it has a real chance of being read before it self-dismisses,
 *  even though it carries no action button of its own. */
export function notifyMigrationWarnings(warnings: readonly string[]): void {
  if (!warnings.length) return;
  toast(warnings[0] + (warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ""), "info", { ttlMs: TOAST_ACTION_TTL });
}
