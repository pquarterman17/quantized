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
//
// LIBRARY_WORKBOOK_UX_PLAN PR C additions (all three transient — E2 owns
// persistence, per the plan's PR sequence; see architecture.test.ts's
// HISTORY_EXCLUDED for the matching justification):
//   - `expandedWorkbookIds` — the tree renderer's workbook disclosure state,
//     the workbook-layer sibling of `expandedFolders` (folders live on
//     useApp.ts already; workbooks land here to avoid touching that
//     zero-headroom file for UI-only state).
//   - `librarySelection` — the tree's folder/workbook selection. Deliberately
//     NOT a third parallel selection array: dataset selection stays
//     `selectedIds` (useApp.ts) exactly as today, and this field only covers
//     the two kinds `selectedIds` cannot express. Selecting a dataset row
//     clears it (DatasetRow.tsx's click handler) so the two never disagree
//     about what's current.
//   - `workbookLastChild` — L0.6's "double-click reopens the remembered
//     child": workbook id -> the last-opened child's canonical
//     LibraryNodeKey. Written by `components/Library/libraryOpen.ts`'s
//     `openLibraryNode` (the single open dispatcher every row funnels
//     through) so every open path — tree, reused DatasetRow/FigureRow,
//     the new light artifact rows — records the same way.

import { updateFolder as treeUpdateFolder } from "../lib/foldertree";
import type { AppState } from "./useApp";

/** L0.46/L0.5-L0.6/L0.25: what the Library tree currently has "current" for
 *  import targeting and selection — every node kind `selectedIds` cannot
 *  express. Worksheets are the one deliberate exception: their selection IS
 *  `selectedIds` (the app-wide dataset multi-selection, with Ctrl/Cmd toggle
 *  and Shift range), and the two stay mutually exclusive at the store
 *  chokepoints — a non-null librarySelection clears selectedIds and vice
 *  versa — so the tree always shows exactly one coherent current item. */
export interface LibrarySelection {
  kind: "folder" | "workbook" | "origin-figure" | "editable-figure" | "publication-figure" | "page" | "report";
  id: string;
}

/** What's being drag-sourced right now (module-internal drag, not an OS file
 *  drop) — null when no drag is in flight. "workbook" (PR C review fix)
 *  replaces the retired dataset→folder gesture as the thing FolderRow's
 *  resting drop-candidate highlight now reacts to for worksheet placement —
 *  a plain "dataset" drag no longer marks any folder as a candidate. */
export interface ActiveDrag {
  kind: "dataset" | "folder" | "workbook";
  id: string;
}

export interface LibraryPanelSlice {
  libraryPanelWidth: number;
  revealTarget: string | null;
  /** Ask the Library to clear its filter, expand the target's collapsed
   *  ancestors, select it (L0.25), and scroll it into view (plan #13
   *  sub-item 2; PR D2 generalizes it for L0.26's search "Show in Library").
   *  Accepts a canonical `kind:id` LibraryNodeKey for any node kind, or a
   *  bare dataset id (the pre-D2 callers — treated as `worksheet:<id>`). */
  requestReveal: (target: string) => void;
  /** Consumed by Library.tsx once the reveal has run. */
  clearReveal: () => void;
  updateFolder: (id: string, patch: { notes?: string; color?: string; defaultTemplate?: string }) => void;
  /** GUI_INTERACTION #3 sub-item 2b — see the module doc above. */
  activeDrag: ActiveDrag | null;
  setActiveDrag: (drag: ActiveDrag | null) => void;
  /** PR C — workbook disclosure state (transient; E2 persists it). */
  expandedWorkbookIds: string[];
  toggleWorkbookExpanded: (id: string) => void;
  /** PR C — current folder/workbook selection (transient; E2 persists it). */
  librarySelection: LibrarySelection | null;
  setLibrarySelection: (selection: LibrarySelection | null) => void;
  /** PR C — L0.6 remembered workbook child, workbook id -> LibraryNodeKey. */
  workbookLastChild: Record<string, string>;
  setWorkbookLastChild: (workbookId: string, childKey: string) => void;
}

/** PR C: the active dataset's workbook is always disclosed — activation
 *  means "show me this sheet", and a collapsed parent workbook would hide
 *  the very row that's now active/selected in the tree. One-directional:
 *  activation expands, only the user's own toggle collapses (and a
 *  collapsed workbook offers no sheet row to activate, so the two never
 *  fight). Spread into `focusedRebindPatch` (windows.ts) so setActive AND
 *  rebindWindow's focused-drop path both get it; import-time creation has
 *  its own parallel rule in store/importDatasets.ts. Lives here, beside the
 *  `expandedWorkbookIds` state it patches, not in the zero-headroom
 *  windows.ts. */
export function workbookDisclosurePatch(
  s: AppState,
  ds: { workbookId?: string } | undefined,
): Partial<AppState> {
  return ds?.workbookId != null && !s.expandedWorkbookIds.includes(ds.workbookId)
    ? { expandedWorkbookIds: [...s.expandedWorkbookIds, ds.workbookId] }
    : {};
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export function createLibraryPanelSlice(set: SliceSet, initialWidth: number): LibraryPanelSlice {
  return {
    libraryPanelWidth: initialWidth,
    revealTarget: null,
    requestReveal: (target) => set({ revealTarget: target }),
    clearReveal: () => set({ revealTarget: null }),
    updateFolder: (id, patch) => set((s) => ({ folders: treeUpdateFolder(s.folders, id, patch) })),
    activeDrag: null,
    setActiveDrag: (activeDrag) => set({ activeDrag }),
    expandedWorkbookIds: [],
    toggleWorkbookExpanded: (id) =>
      set((s) => ({
        expandedWorkbookIds: s.expandedWorkbookIds.includes(id)
          ? s.expandedWorkbookIds.filter((x) => x !== id)
          : [...s.expandedWorkbookIds, id],
      })),
    librarySelection: null,
    // L0.25 selection coherence (P1 fix): the tree's folder/workbook
    // selection and the dataset selection are mutually exclusive. Setting a
    // non-null librarySelection ALWAYS clears selectedIds here — the single
    // chokepoint — rather than relying on every row component that can
    // trigger a folder/workbook select (WorkbookRow.select/FolderRow's
    // onClick, today; anything added later) to remember to clear it itself.
    // The reverse direction (activating/selecting a dataset clears
    // librarySelection) lives at ITS OWN chokepoints: activateFromLibrary/
    // toggleSelected/selectRange (useApp.ts) and focusedRebindPatch
    // (windows.ts, shared by setActive). Together the two directions close
    // the gap that let a stale worksheet selectedIds/activeId survive
    // alongside a freshly-selected workbook/folder — LibraryTree.tsx's own
    // Delete/Backspace handling is the other half of that fix.
    setLibrarySelection: (librarySelection) =>
      set({ librarySelection, ...(librarySelection ? { selectedIds: [] } : {}) }),
    workbookLastChild: {},
    setWorkbookLastChild: (workbookId, childKey) =>
      set((s) => ({ workbookLastChild: { ...s.workbookLastChild, [workbookId]: childKey } })),
  };
}
