// N10: the editable figures ticked in the Library for the one-PDF export, in
// tick order (= page order). A tiny standalone store so the tree rows, the flat
// section and the export bar share one list without touching the main store.

import { create } from "zustand";

interface FigurePdfTicks {
  ids: string[];
  toggle: (id: string) => void;
  clear: () => void;
}

export const useFigurePdfTicks = create<FigurePdfTicks>((set) => ({
  ids: [],
  toggle: (id) => set((s) => ({ ids: s.ids.includes(id) ? s.ids.filter((x) => x !== id) : [...s.ids, id] })),
  clear: () => set({ ids: [] }),
}));
