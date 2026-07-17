// Library panel UI state (GUI_INTERACTION_PLAN #13 — folder organization
// density) — composed into the ONE useApp store instance exactly like
// ./pointerTool/./reductions (read windows.ts's header first): kept in its
// OWN file so this feature's new state doesn't grow store/useApp.ts past its
// architecture.test.ts size-ratchet pin (same "small new slice" reasoning as
// every other extracted slice).
//
// Three concerns share this one small file (kept small so an over-budget
// useApp.ts can shed a self-contained block here post-merge with main's
// #7/#10/#14 slices, rather than raise the ratchet pin):
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
//   - `updateFolder` — Folder Properties (sub-item 4: notes/colour/
//     defaultTemplate). Lives HERE rather than alongside the other folder
//     actions in useApp.ts purely for ratchet headroom; it's still a normal
//     top-level store field at runtime (see pointerTool.ts's header for why
//     that's safe) — `renameFolder` (useApp.ts) still owns the name.

import { updateFolder as treeUpdateFolder } from "../lib/foldertree";
import type { AppState } from "./useApp";

export interface LibraryPanelSlice {
  libraryPanelWidth: number;
  revealTarget: string | null;
  /** Ask the Library tree to clear its filter, expand the dataset's ancestor
   *  folders, scroll to it, and select it (plan #13 sub-item 2). */
  requestReveal: (datasetId: string) => void;
  /** Consumed by Library.tsx once the reveal has run. */
  clearReveal: () => void;
  updateFolder: (id: string, patch: { notes?: string; color?: string; defaultTemplate?: string }) => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export function createLibraryPanelSlice(set: SliceSet, initialWidth: number): LibraryPanelSlice {
  return {
    libraryPanelWidth: initialWidth,
    revealTarget: null,
    requestReveal: (datasetId) => set({ revealTarget: datasetId }),
    clearReveal: () => set({ revealTarget: null }),
    updateFolder: (id, patch) => set((s) => ({ folders: treeUpdateFolder(s.folders, id, patch) })),
  };
}
