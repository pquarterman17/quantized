// Panel insets slice (#15): owns `PlotView.panelInsets` (swapped per-window
// by the focused-window facade, exactly like `shapes`/`annotations` —
// see `store/shapes.ts`'s header for the pattern this mirrors) plus the
// transient selection id (not a PlotView field, not undo-recorded — same
// "selectedShapeId" convention). Kept in its own file for the same
// store-size-ratchet reason `shapes.ts` gives: `useApp.ts` is pinned tight.

import { DEFAULT_PANEL_INSET_AT, type PanelInset, type PanelInsetContent } from "../lib/panelInset";
import { nextPlotObjectId } from "./idSeq";
import type { AppState } from "./useApp";

export interface PanelInsetsSlice {
  /** Panel insets (#15): boxes showing another dataset/an image/a table. A
   *  `PlotView` field — persists via `.dwk` (`lib/panelInset.ts`'s
   *  `sanitizePanelInsets`). */
  panelInsets: PanelInset[];
  /** The panel inset selected in pointer mode; null = nothing selected. */
  selectedPanelInsetId: string | null;
  setSelectedPanelInsetId: (id: string | null) => void;
  /** Add a new panel inset (Insert menu commit); returns its id. */
  addPanelInset: (content: PanelInsetContent, at?: PanelInset["at"]) => string;
  /** Commit a panel-inset edit (drag-move, resize, re-pick content) ONCE —
   *  the shapes/annotations "plugin-local live preview, store commits on
   *  release" pattern. No-op for an unknown id. */
  updatePanelInset: (id: string, patch: Partial<Omit<PanelInset, "id">>) => void;
  removePanelInset: (id: string) => void;
  clearPanelInsets: () => void;
  /** The Insert-panel dialog's visibility; UI dialog state, not undo-recorded
   *  (same convention as `splitDialogTargetId`). */
  insertDialogOpen: boolean;
  openInsertPanelInsetDialog: () => void;
  closeInsertPanelInsetDialog: () => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export function createPanelInsetsSlice(set: SliceSet, get: SliceGet): PanelInsetsSlice {
  return {
    panelInsets: [],
    selectedPanelInsetId: null,
    setSelectedPanelInsetId: (selectedPanelInsetId) => set({ selectedPanelInsetId }),
    addPanelInset: (content, at) => {
      const id = nextPlotObjectId("panel-inset");
      get().recordHistory("insert panel");
      set((s) => ({
        panelInsets: [...s.panelInsets, { id, at: at ?? DEFAULT_PANEL_INSET_AT, content }],
      }));
      return id;
    },
    updatePanelInset: (id, patch) => {
      get().recordHistory("edit panel");
      set((s) => ({
        panelInsets: s.panelInsets.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      }));
    },
    removePanelInset: (id) => {
      get().recordHistory("delete panel");
      set((s) => ({
        panelInsets: s.panelInsets.filter((p) => p.id !== id),
        selectedPanelInsetId: s.selectedPanelInsetId === id ? null : s.selectedPanelInsetId,
      }));
    },
    clearPanelInsets: () => {
      get().recordHistory("clear panels");
      set({ panelInsets: [], selectedPanelInsetId: null });
    },
    insertDialogOpen: false,
    openInsertPanelInsetDialog: () => set({ insertDialogOpen: true }),
    closeInsertPanelInsetDialog: () => set({ insertDialogOpen: false }),
  };
}
