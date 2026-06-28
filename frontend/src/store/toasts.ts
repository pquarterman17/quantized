// Transient toast notifications (design interaction layer). A standalone store
// (like store/commands) so any call site — store actions, handlers, components —
// can confirm an action fired without coupling to the main app store or causing
// its subscribers to re-render. The StatusBar remains the persistent status line;
// toasts are the fleeting "it happened" confirmations.

import { create } from "zustand";

export type ToastKind = "info" | "ok" | "danger";

export interface Toast {
  id: number;
  msg: string;
  kind: ToastKind;
}

interface ToastsState {
  toasts: Toast[];
  push: (msg: string, kind?: ToastKind) => void;
  dismiss: (id: number) => void;
}

// Monotonic id (no Date.now/Math.random → deterministic in tests).
let seq = 0;
/** How long a toast lingers before auto-dismiss. */
export const TOAST_TTL = 1900;
/** Cap concurrent toasts so a burst can't cover the screen. */
const MAX = 4;

export const useToasts = create<ToastsState>((set, get) => ({
  toasts: [],
  push: (msg, kind = "info") => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts, { id, msg, kind }].slice(-MAX) }));
    setTimeout(() => get().dismiss(id), TOAST_TTL);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helper for non-component call sites (store actions, callbacks). */
export function toast(msg: string, kind?: ToastKind): void {
  useToasts.getState().push(msg, kind);
}
