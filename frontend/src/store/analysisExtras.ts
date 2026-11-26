// Open state of the "analysis extras" tool windows (surface fit, optical gap,
// ellipse fit; gap audit 5 lane I). One tiny standalone store: the panels sit
// behind a single lazy host, so the eager cost is this file plus one flag.

import { create } from "zustand";

export type AnalysisExtra = "surface-fit" | "optical-gap" | "ellipse-fit" | "map-ops" | "map-grid" | "map-analysis" | "time-series" | "spectro-extras" | "curve-measure" | "math-extras" | "graph-browser";

interface State {
  open: readonly AnalysisExtra[];
  show: (k: AnalysisExtra) => void;
  hide: (k: AnalysisExtra) => void;
}

export const useAnalysisExtras = create<State>((set) => ({
  open: [],
  show: (k) => set((s) => (s.open.includes(k) ? s : { open: [...s.open, k] })),
  hide: (k) => set((s) => ({ open: s.open.filter((o) => o !== k) })),
}));
