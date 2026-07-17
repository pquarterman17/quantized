// Library panel UI state (GUI_INTERACTION_PLAN #13 — folder organization
// density) — composed into the ONE useApp store instance exactly like
// ./pointerTool/./reductions (read windows.ts's header first): kept in its
// OWN file so this feature's new state doesn't grow store/useApp.ts past its
// architecture.test.ts size-ratchet pin (same "small new slice" reasoning as
// every other extracted slice).
//
// Four concerns share this one small file (kept small so an over-budget
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
//   - `activeDrag` — GUI_INTERACTION #3 sub-item 2b's "reveal every valid
//     drop target the moment a drag starts" state. Set by a dataset/folder
//     row's `.qzk-drag-handle` `onDragStart` (cleared on `onDragEnd`) — the
//     dragged object's OWN id, not just a boolean, so a folder row can
//     self-exclude (a folder can't become its own drop target, nor a
//     descendant's) without needing to read `dataTransfer.getData()` (browsers
//     only allow that on `drop`, not `dragover`/render). Every consumer
//     (FolderRow's resting "candidate" tint, PlotWindowFrame's rebind-target
//     tint) reads it non-reactively where a per-row render doesn't need to
//     re-run on every OTHER row's drag, and reactively where the whole-tree
//     highlight does.

import { updateFolder as treeUpdateFolder } from "../lib/foldertree";
import type { AppState } from "./useApp";

/** What's being drag-sourced right now (module-internal drag, not an OS file
 *  drop) — null when no drag is in flight. */
export interface ActiveDrag {
  kind: "dataset" | "folder";
  id: string;
}

export interface LibraryPanelSlice {
  libraryPanelWidth: number;
  revealTarget: string | null;
  /** Ask the Library tree to clear its filter, expand the dataset's ancestor
   *  folders, scroll to it, and select it (plan #13 sub-item 2). */
  requestReveal: (datasetId: string) => void;
  /** Consumed by Library.tsx once the reveal has run. */
  clearReveal: () => void;
  updateFolder: (id: string, patch: { notes?: string; color?: string; defaultTemplate?: string }) => void;
  /** GUI_INTERACTION #3 sub-item 2b — see the module doc above. */
  activeDrag: ActiveDrag | null;
  setActiveDrag: (drag: ActiveDrag | null) => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export function createLibraryPanelSlice(set: SliceSet, initialWidth: number): LibraryPanelSlice {
  return {
    libraryPanelWidth: initialWidth,
    revealTarget: null,
    requestReveal: (datasetId) => set({ revealTarget: datasetId }),
    clearReveal: () => set({ revealTarget: null }),
    updateFolder: (id, patch) => set((s) => ({ folders: treeUpdateFolder(s.folders, id, patch) })),
    activeDrag: null,
    setActiveDrag: (activeDrag) => set({ activeDrag }),
  };
}
