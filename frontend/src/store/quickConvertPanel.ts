// Quick Convert (in-app): the open flag, dependency-free so AppOverlayPanels can
// read it without pulling in the converter (the packProjectPanel shape).

import { create } from "zustand";

interface QuickConvertPanelState {
  open: boolean;
  openPanel: () => void;
  close: () => void;
}

export const useQuickConvertPanel = create<QuickConvertPanelState>((set) => ({
  open: false,
  openPanel: () => set({ open: true }),
  close: () => set({ open: false }),
}));
