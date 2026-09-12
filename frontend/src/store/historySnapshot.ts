// WHAT an undo snapshot contains, and how one is taken and applied.
//
// Split out of `store/history.ts` when that file crossed the 500-line ceiling.
// It is the natural seam: everything here is PURE (AppState in, plain object
// out) and knows nothing about the stack, the batch token, or `set`/`get` —
// `history.ts` keeps the slice, the stack arithmetic and the coalescing rule,
// and imports these three.
//
// The allowlist contract below is the load-bearing part; read it before adding
// any field to AppState.

import { hydrateView, navigationView, snapshotView, type PlotView } from "../lib/plotview";
import { focusTransientReset } from "./windows";
import type { AppState } from "./useApp";

/** The undoable slice of AppState — see the module doc for why this exact
 *  field list and no more.
 *
 *  CRITICAL: This is an **inclusion allowlist**, not a struct that tracks in
 *  parallel — any new persistent store field is SILENTLY OUTSIDE undo until
 *  added here AND in snapshotOf(). The `savedRois` field was forgotten for a
 *  day (2026-08-09–2026-08-10), making ROI deletions unrecoverable.
 *
 *  When adding a new field to AppState:
 *  1. Decide: does this field represent a **persistent user edit** that should
 *     survive Ctrl+Z, or is it **transient/UI-only** state?
 *  2. If persistent → add it here AND to snapshotOf() below.
 *  3. If transient → add it to the HISTORY_EXCLUDED list in
 *     frontend/src/architecture.test.ts with a clear justification comment —
 *     the test will verify the classification is exhaustive and intentional.
 *
 *  See store/rois.ts for the rationale behind excluding `mapRoi`/`mapRuler`
 *  (working geometry that survives dataset switches but not undo).
 */
export interface HistorySnapshot {
  datasets: AppState["datasets"];
  activeId: AppState["activeId"];
  selectedIds: AppState["selectedIds"];
  worksheetId: AppState["worksheetId"];
  originFigures: AppState["originFigures"];
  originFidelity: AppState["originFidelity"];
  reports: AppState["reports"];
  figureDocs: AppState["figureDocs"];
  editableFigures: AppState["editableFigures"];
  pages: AppState["pages"];
  folders: AppState["folders"];
  // Retrospective-audit fix (2026-08-15): `expandedFolders` round-trips into
  // `.dwk` v2 — it is persistent project data, not transient UI state like
  // `expandedWorkbookIds` (whose E2-owned exclusion is documented in
  // architecture.test.ts). `folderDeletePatch` prunes it under
  // recordHistory("delete folder"), and without this field an undone folder
  // delete restored the folder COLLAPSED — the exact half-restored-state
  // failure this file's header warns about (the savedRois incident).
  expandedFolders: AppState["expandedFolders"];
  // LIBRARY_WORKBOOK_UX_PLAN PR A2 — persistent Library organization, same
  // class as `folders` right above it (not yet mutated by any action; wired
  // here now so the FIRST mutating action in a later PR inherits undo for
  // free instead of repeating the `savedRois` omission this file's header warns about).
  workbooks: AppState["workbooks"];
  smartFolders: AppState["smartFolders"];
  savedPlotSpecs: AppState["savedPlotSpecs"];
  activePlotSpecId: AppState["activePlotSpecId"];
  savedRois: AppState["savedRois"];
  // LIBRARY_WORKBOOK_UX_PLAN PR H — named Quick Plot templates. Persistent
  // user edits (save/rename/delete), same class as `savedPlotSpecs`/
  // `savedRois` right above — wired here IN THE SAME COMMIT as the store
  // slice (store/quickPlotTemplates.ts) per this file's own savedRois-
  // incident gate, not as an afterthought.
  quickPlotTemplates: AppState["quickPlotTemplates"];
  // P1.3 wave 2 Lane B — named plot recipes (store/plotRecipes.ts). Persistent
  // user edits (save/rename/delete/duplicate; apply creates a figure, already
  // covered via `editableFigures`/`plotWindows` below), same class as
  // `quickPlotTemplates` right above — wired here in the SAME commit as the
  // store slice per this file's own savedRois-incident gate.
  plotRecipes: AppState["plotRecipes"];
  // LIBRARY_WORKBOOK_UX_PLAN PR L (L0.48/L0.49/L0.56) — Collection save/
  // rename/re-query/delete is an undoable project edit, same class as
  // `quickPlotTemplates`/`smartFolders` right above.
  collections: AppState["collections"];
  plotWindows: AppState["plotWindows"];
  focusedWindowId: AppState["focusedWindowId"];
  view: PlotView;
}


export function snapshotOf(s: AppState): HistorySnapshot {
  return {
    datasets: s.datasets,
    activeId: s.activeId,
    selectedIds: s.selectedIds,
    worksheetId: s.worksheetId,
    originFigures: s.originFigures,
    originFidelity: s.originFidelity,
    reports: s.reports,
    figureDocs: s.figureDocs,
    editableFigures: s.editableFigures,
    pages: s.pages,
    folders: s.folders,
    expandedFolders: s.expandedFolders,
    workbooks: s.workbooks,
    smartFolders: s.smartFolders,
    savedPlotSpecs: s.savedPlotSpecs,
    activePlotSpecId: s.activePlotSpecId,
    savedRois: s.savedRois,
    quickPlotTemplates: s.quickPlotTemplates,
    plotRecipes: s.plotRecipes,
    collections: s.collections,
    plotWindows: s.plotWindows,
    focusedWindowId: s.focusedWindowId,
    view: snapshotView(s),
  };
}

/** Post-restore guards (both `undo` and `redo` apply these): restore the
 *  snapshot's fields verbatim, drop a row selection that no longer names a
 *  live dataset, null any window's dataset binding that no longer exists in
 *  the restored library (mirrors `removeDataset`'s own going-forward
 *  treatment — see the module doc), and clear transient tool/gadget/overlay
 *  state exactly as a dataset switch does (`focusTransientReset`, reused
 *  verbatim from the windows slice — the same set `setActive`/
 *  `focusWindow`/`closeWindow` already clear on any underlying-data swap). */
export function restorePatch(s: AppState, snap: HistorySnapshot): Partial<AppState> {
  const live = new Set(snap.datasets.map((d) => d.id));
  // Destructure `view` out: it is a nested field of the SNAPSHOT, not of
  // AppState, and spreading `snap` wholesale wrote an inert `state.view` onto
  // the live store on every undo/redo (harmless today, a silent clobber the
  // day AppState gains a real `view` field).
  const { view, ...fields } = snap;
  return {
    ...fields,
    ...hydrateView(view),
    // Then put the LIVE zoom/pan back. `hydrateView` restores every PlotView
    // field including the navigation ones, so without this an ordinary
    // Ctrl+Z ("undo add shape") also silently discarded a zoom performed
    // afterwards — and left the separate viewHistory/viewFuture stack
    // pointing at bounds that are no longer live. Navigation is undone with
    // Alt+left/right, edits with Ctrl+Z; this keeps that split intact.
    ...navigationView(s),
    selection: s.selection && live.has(s.selection.datasetId) ? s.selection : null,
    // L0.25 on undo/redo (hardening review fix — undo was a SEVENTH
    // invariant violator): the snapshot restores `selectedIds` verbatim, so
    // a non-empty restored dataset selection displaces the live tree
    // selection; and a surviving tree selection must still NAME something in
    // the restored state — undoing a folder's creation while it was selected
    // otherwise left a dangling id feeding import targeting.
    librarySelection: (() => {
      if (snap.selectedIds.length > 0) return null;
      const sel = s.librarySelection;
      if (!sel) return null;
      const alive =
        sel.kind === "folder" ? snap.folders.some((f) => f.id === sel.id)
        : sel.kind === "workbook" ? snap.workbooks.some((w) => w.id === sel.id)
        : sel.kind === "origin-figure" ? snap.originFigures.some((f) => f.id === sel.id)
        : sel.kind === "editable-figure" ? snap.editableFigures.some((f) => f.id === sel.id)
        : sel.kind === "publication-figure" ? snap.figureDocs.some((f) => f.id === sel.id)
        : sel.kind === "page" ? snap.pages.some((pg) => pg.id === sel.id)
        : snap.reports.some((r) => r.id === sel.id);
      return alive ? sel : null;
    })(),
    plotWindows: snap.plotWindows.map((w) =>
      w.datasetId && !live.has(w.datasetId) ? { ...w, datasetId: null } : w,
    ),
    ...focusTransientReset(),
  };
}
