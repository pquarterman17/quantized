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
  /** Leave the toast up after the click (a "Details" / "Copy" that must not
   *  take the toast's other actions away). */
  keep?: boolean;
}

export interface Toast {
  id: number;
  msg: string;
  kind: ToastKind;
  action?: ToastAction;
  /** Several choices (the late-restore prompt's Append / Replace / Discard);
   *  rendered after `action`, each dismissing like it. */
  actions?: ToastAction[];
  /** Toasts of one kind of event (an import failure) that the Toaster folds
   *  into one "3 files couldn't be read · Show" toast once more than two are
   *  up (UX audit 8 #9: three failures stacked into a tall column). */
  group?: ToastGroup;
}

export interface ToastGroup {
  key: string;
  /** The folded toast's text for `n` -- the members' `count`s summed. */
  summary: (n: number) => string;
  /** How many events this toast stands for (a batch toast reporting three
   *  failed files is 3); default 1. A member pushed out by the `MAX` cap
   *  hands its count to the oldest member still up, so the summary keeps
   *  counting every failure, not just the toasts that fit. */
  count?: number;
}

/** The events a grouped toast stands for. */
export const groupCount = (t: Toast): number => t.group?.count ?? 1;

/** Optional extras beyond message + kind. `ttlMs` overrides the default
 *  auto-dismiss timer — an action toast asks the user to read and decide,
 *  not just glance, so one with an `action` and no `ttlMs` defaults to
 *  `TOAST_ACTION_TTL` rather than `TOAST_TTL`. */
export interface ToastOptions {
  action?: ToastAction;
  actions?: ToastAction[];
  ttlMs?: number;
  group?: ToastGroup;
}

interface ToastsState {
  toasts: Toast[];
  push: (msg: string, kind?: ToastKind, opts?: ToastOptions) => void;
  dismiss: (id: number) => void;
  /** Add (`on`) or lift one hold on a toast's auto-dismiss: the pointer over
   *  it, or focus in it. It never times out while any hold remains. */
  hold: (id: number, on: boolean) => void;
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

/** How many holds (pointer over it, focus in it) each toast has. A toast
 *  whose timer runs out while held is marked expired and goes only once the
 *  last hold lifts, after `TOAST_TTL` more (WCAG 2.2.1). */
const held = new Map<number, number>();
const expired = new Set<number>();

function expire(id: number): void {
  if (held.get(id)) expired.add(id);
  else useToasts.getState().dismiss(id);
}

export const useToasts = /* @__PURE__ */ create<ToastsState>((set) => ({
  toasts: [],
  push: (msg, kind = "info", opts) => {
    const id = ++seq;
    totalCount += 1;
    if (kind === "danger") {
      errorCount += 1;
      lastErrorAt = Date.now();
    }
    set((s) => ({
      toasts: capped([...s.toasts, { id, msg, kind, action: opts?.action, actions: opts?.actions, group: opts?.group }]),
    }));
    // An action toast lives long enough to act on even when the caller does not
    // say so (BUG-009's Re-import offer relies on this: importing the constant
    // there broke the many suites that `vi.mock` this module with `toast` alone).
    setTimeout(() => expire(id), opts?.ttlMs ?? (opts?.action || opts?.actions ? TOAST_ACTION_TTL : TOAST_TTL));
  },
  dismiss: (id) => {
    held.delete(id);
    expired.delete(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  hold: (id, on) => {
    const n = Math.max(0, (held.get(id) ?? 0) + (on ? 1 : -1));
    held.set(id, n);
    if (!n && expired.delete(id)) setTimeout(() => expire(id), TOAST_TTL);
  },
}));

/** The newest `MAX` toasts; a grouped toast pushed out hands its count to
 *  the oldest kept member of its group (`ToastGroup.count`). */
function capped(all: Toast[]): Toast[] {
  const kept = all.slice(-MAX);
  for (const gone of all.slice(0, -MAX)) {
    const i = gone.group ? kept.findIndex((t) => t.group?.key === gone.group!.key) : -1;
    if (i < 0) continue;
    const heir = kept[i];
    kept[i] = { ...heir, group: { ...heir.group!, count: groupCount(heir) + groupCount(gone) } };
  }
  return kept;
}

/** Imperative helper for non-component call sites (store actions, callbacks). */
export function toast(msg: string, kind?: ToastKind, opts?: ToastOptions): void {
  useToasts.getState().push(msg, kind, opts);
}

/** A lazy chunk would not load: the same message in the status line and in a
 *  danger toast whose Retry re-asks (store/recalcEngine.ts, the formula
 *  module in store/computedColumns.ts). Never silent. */
export function failWithRetry(setStatus: (msg: string) => void, msg: string, retry: () => void): void {
  setStatus(msg);
  toast(msg, "danger", { action: { label: "Retry", onClick: retry } });
}

// `notifyMigrationWarnings` live in ./toastsMigration.ts: no eager module uses them.
export * from "./toastsMigration";
