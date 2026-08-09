// ROI cuts workshop's open-flag slice (RSM_CUTS_PLAN item 8), composed into
// the ONE useApp store instance exactly like ./reductions and ./graphBuilder
// (read windows.ts's header first): useApp spreads
// `createRoiCutsPanelSlice(set)` in, so every existing `useApp((s) => ...)`
// selector keeps working — this file is a code boundary, not a second store.
//
// Kept to a single open flag on purpose: store/rois.ts already owns the
// box/ruler/sector/saved-ROI DATA this panel edits (mapRoi/mapRuler/
// savedRois — item 4), so this slice only needs the ToolWindow's visibility,
// the one piece every OTHER workshop (reductions.ts, graphBuilder.ts,
// trash.ts) keeps in its own tiny file rather than growing store/useApp.ts's
// core fields — that module sits at its store-size ratchet pin with almost
// no headroom, so a new field there is the one thing to avoid.

import type { AppState } from "./useApp";

export interface RoiCutsPanelSlice {
  roiCutsOpen: boolean;
  setRoiCutsOpen: (open: boolean) => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export function createRoiCutsPanelSlice(set: SliceSet): RoiCutsPanelSlice {
  return {
    roiCutsOpen: false,
    setRoiCutsOpen: (roiCutsOpen) => set({ roiCutsOpen }),
  };
}
