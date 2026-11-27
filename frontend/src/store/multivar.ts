// Multivariate workbench open state (JMP_GAP_PLAN J10). A standalone store —
// the store/help.ts / store/fitYByX.ts precedent — rather than a flag on
// useApp.ts: useApp sits at its size-ratchet pin (a new flag there would
// blow it), and panel visibility couples to nothing in the main app store.

import { create } from "zustand";
import type { MultivariateRecipe } from "../lib/multivariateAnalysisResult";

/** A typed launch: the tab (and, on the PLS / LDA or Clustering tab, the tool) to open on. */
export interface MultivarLaunch {
  tab: "correlation" | "splom" | "pca" | "ext" | "cluster";
  tool?: "pls" | "lda";
  cluster?: "kmeans" | "hierarchical";
}

interface MultivarPanelState {
  open: boolean;
  request: MultivariateRecipe | null;
  /** Set by `openTab`; any other open or close clears it, so a later plain open starts on Correlation. */
  launch: MultivarLaunch | null;
  openTab: (launch: MultivarLaunch) => void;
  setOpen: (open: boolean) => void;
  openWith: (request: MultivariateRecipe) => void;
  consumeRequest: () => void;
}

export const useMultivarStore = create<MultivarPanelState>((set) => ({
  open: false,
  request: null,
  launch: null,
  openTab: (launch) => set({ open: true, launch }),
  setOpen: (open) => set({ open, launch: null }),
  openWith: (request) => set({ open: true, request, launch: null }),
  consumeRequest: () => set({ request: null }),
}));
