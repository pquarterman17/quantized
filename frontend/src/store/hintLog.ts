// The reviewable hint log (plan item 45): the last HINT_LOG_MAX status-line
// messages and toasts, with the time, the text and the label of any action
// button a toast carried, so a message that vanished can still be read.
//
// IN MEMORY ONLY, by construction: nothing here touches storage, a file or the
// diagnostics bundle. store/toasts.ts explains why the bundle never keeps
// message text (dataset names, paths); this log is the user's own session view
// of the same text, so it must not reach anything that leaves the app.
//
// Passive: it listens to the status line (`useApp.status`) and the toast
// store; it changes neither. `startHintLog` runs once, from the lazy
// LearningHost chunk after first paint, so a message in the first moments of
// startup is not logged. The action is recorded as its LABEL only. The
// callback is a closure over state from when the toast showed, so it stays
// out of a list that is read later (fail closed: the log never re-runs one).

import { create } from "zustand";

import { useToasts } from "./toasts";
import { useApp } from "./useApp";

export const HINT_LOG_MAX = 50;
/** A toast repeating the status line's text within this many ms merges into its row. */
const MERGE_MS = 2000;

export type HintTone = "ok" | "info" | "warn" | "danger";

export interface HintEntry {
  id: number;
  /** Epoch ms. */
  at: number;
  source: "status" | "toast";
  tone: HintTone;
  text: string;
  /** Labels of the action buttons the message carried (never their callbacks). */
  actions: string[];
}

interface HintLogState {
  entries: HintEntry[];
  record: (e: Omit<HintEntry, "id" | "at"> & { at?: number }) => void;
  clear: () => void;
}

let seq = 0;

export const useHintLog = create<HintLogState>((set) => ({
  entries: [],
  record: (e) =>
    set((s) => {
      const at = e.at ?? Date.now();
      const last = s.entries[s.entries.length - 1];
      if (last && last.text === e.text && last.source !== e.source && at - last.at <= MERGE_MS) {
        const actions = [...new Set([...last.actions, ...e.actions])];
        const tone = e.tone === "danger" || last.tone === "danger" ? "danger" : last.tone;
        return { entries: [...s.entries.slice(0, -1), { ...last, actions, tone }] };
      }
      return { entries: [...s.entries, { id: ++seq, at, source: e.source, tone: e.tone, text: e.text, actions: e.actions }].slice(-HINT_LOG_MAX) };
    }),
  clear: () => set({ entries: [] }),
}));

let stop: (() => void) | null = null;

/** Begin logging (idempotent); returns the stop function. */
export function startHintLog(): () => void {
  if (stop) return stop;
  const record = useHintLog.getState().record;
  let lastToast = useToasts.getState().toasts.reduce((m, t) => Math.max(m, t.id), 0);
  const offStatus = useApp.subscribe((s, prev) => {
    if (s.status === prev.status || !s.status) return;
    const tone: HintTone = s.statusDanger === s.status ? "danger" : s.statusWarn === s.status ? "warn" : "ok";
    record({ source: "status", tone, text: s.status, actions: [] });
  });
  const offToasts = useToasts.subscribe((s) => {
    for (const t of s.toasts) {
      if (t.id <= lastToast) continue;
      lastToast = t.id;
      const labels = [t.action, ...(t.actions ?? [])].flatMap((a) => (a ? [a.label] : []));
      record({ source: "toast", tone: t.kind, text: t.msg, actions: labels });
    }
  });
  stop = () => {
    offStatus();
    offToasts();
    stop = null;
  };
  return stop;
}
