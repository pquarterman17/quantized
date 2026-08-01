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
