// Library panel UI state (GUI_INTERACTION_PLAN #13 — folder organization
// density) — composed into the ONE useApp store instance exactly like
// ./pointerTool/./reductions (read windows.ts's header first): kept in its
// OWN file so this feature's new state doesn't grow store/useApp.ts past its
// architecture.test.ts size-ratchet pin (same "small new slice" reasoning as
// every other extracted slice).
//
// Two concerns share this one small file:
//   - `libraryPanelWidth` — the resizable Library panel's width. Its VALUE
//     rides the qz.prefs blob (store/prefs.ts owns load/save; useApp.ts's
//     generic `setPref` already covers writes — see `PrefKey`), so this
//     slice only contributes the field's TYPE + initial value, mirroring how
//     `legendXY` lives on pointerTool.ts even though it's a genuine
//     PlotView field.
//   - `revealTarget` — the cross-component "Show in folder" signal (sub-item
//     2). A dataset id, or null. DatasetRow's context menu calls
//     `requestReveal(id)`; Library.tsx is the ONLY reader (a useEffect that
//     clears the filter, expands the dataset's ancestor folders, scrolls to
//     + selects the row, then calls `clearReveal()`). Transient, like
//     `selectedAnnotationId` — never persisted, never reset on focus/window
//     switches.

import type { AppState } from "./useApp";

export interface LibraryPanelSlice {
  libraryPanelWidth: number;
  revealTarget: string | null;
  /** Ask the Library tree to clear its filter, expand the dataset's ancestor
   *  folders, scroll to it, and select it (plan #13 sub-item 2). */
  requestReveal: (datasetId: string) => void;
  /** Consumed by Library.tsx once the reveal has run. */
  clearReveal: () => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export function createLibraryPanelSlice(set: SliceSet, initialWidth: number): LibraryPanelSlice {
  return {
    libraryPanelWidth: initialWidth,
    revealTarget: null,
    requestReveal: (datasetId) => set({ revealTarget: datasetId }),
    clearReveal: () => set({ revealTarget: null }),
  };
}
