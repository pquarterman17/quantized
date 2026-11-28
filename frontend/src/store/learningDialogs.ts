// Which learning-aid dialog is open (plan item 45): the hint log, the sample
// gallery or the tip of the day. A standalone store, like store/help.ts, so
// the dialogs cost nothing in the entry chunk: only the lazy commands and the
// lazy LearningHost import it.

import { create } from "zustand";

export type LearningDialog = "hints" | "gallery" | "tips";

interface LearningDialogsState {
  open: LearningDialog | null;
  show: (which: LearningDialog) => void;
  close: () => void;
}

export const useLearningDialogs = create<LearningDialogsState>((set) => ({
  open: null,
  show: (open) => set({ open }),
  close: () => set({ open: null }),
}));
