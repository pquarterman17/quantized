// Help-dialog open state (GUI_INTERACTION #17). A standalone store — the
// store/toasts.ts precedent — rather than a flag on useApp.ts, for two
// reasons: useApp sits at its size-ratchet pin (a new flag there would blow
// it), and help visibility couples to nothing in the main app store, so
// keeping it separate avoids waking every useApp subscriber when Help opens.

import { create } from "zustand";

/** Which top-level section the dialog shows. `search` is the default landing
 *  view (the searchable topic list); the others are browse tabs added by the
 *  later Help slices (importing data, coming from Origin). */
export type HelpSection = "search" | "shortcuts" | "importing" | "origin";

interface HelpState {
  open: boolean;
  section: HelpSection;
  /** "What is this?" inspect mode (GUI_INTERACTION #17): while on, controls
   *  carrying help text are outlined and reveal it instantly on hover. */
  whatIsThis: boolean;
  openHelp: (section?: HelpSection) => void;
  closeHelp: () => void;
  setSection: (section: HelpSection) => void;
  toggleWhatIsThis: () => void;
  setWhatIsThis: (on: boolean) => void;
}

export const useHelp = create<HelpState>((set) => ({
  open: false,
  section: "search",
  whatIsThis: false,
  // Opening the Help dialog exits inspect mode — the two are alternate ways
  // to answer "what is this?", never both at once.
  openHelp: (section = "search") => set({ open: true, section, whatIsThis: false }),
  closeHelp: () => set({ open: false }),
  setSection: (section) => set({ section }),
  toggleWhatIsThis: () => set((s) => ({ whatIsThis: !s.whatIsThis, open: false })),
  setWhatIsThis: (on) => set({ whatIsThis: on }),
}));

/** Imperative helper for non-component call sites (a command's `run`). */
export function openHelp(section?: HelpSection): void {
  useHelp.getState().openHelp(section);
}
