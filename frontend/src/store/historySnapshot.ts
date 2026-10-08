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

import type { BreakComposition, SpatialComposition } from "../lib/composition";
import { hydrateView, navigationView, snapshotView, type PlotView } from "../lib/plotview";
import { focusTransientReset } from "./windows";
import type { LibrarySelection } from "./libraryPanel";
import type { AppState } from "./useApp";

const hasId = (items: readonly { id: string }[], id: string | null): boolean => items.some((item) => item.id === id);

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
  analysisResults: AppState["analysisResults"];
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
  // Undo-coverage audit (2026-10-01): expand/collapse itself is view state and
  // records nothing, so `restorePatch` keeps the LIVE expand state and reads
  // this field only for folders the restore brings back (`restoredExpandedFolders`).
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
  // Audit P2.8 — the durable 2-D map view (colour limits/scale/colormap, the
  // committed H/V/segment slice definitions, the map annotations). Persistent
  // user edits, the same class as `savedRois` right above, and wired here in
  // the SAME commit as store/mapView.ts per this file's own savedRois-incident
  // gate. NOT the working mapRoi/mapRuler/mapSector, which stay excluded.
  mapViews: AppState["mapViews"];
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
  // P2.7 follow-up — the opened project's fit-model records this build could
  // not accept, written back into the .dwk on save. PROJECT state, so it
  // travels with the datasets: undoing an open must not leave the other
  // project's records to be saved into this one, nor undoing "remove all"
  // leave them emptied.
  fitModelCarry: AppState["fitModelCarry"];
  macroSteps: AppState["macroSteps"];
  techniqueViewMemory: AppState["techniqueViewMemory"];
  plotWindows: AppState["plotWindows"];
  focusedWindowId: AppState["focusedWindowId"];
  view: PlotView;
  // The live BREAK or SPATIAL arrangement only — not `composition` wholesale
  // (a render cache, HISTORY_EXCLUDED). A facet rebuilds from `view.facetKey`.
  // An Origin multi-panel apply (spatial) has no durable binding, so without
  // this undo/redo lost its panels. A break (`breakAtGaps`) does have one,
  // `plot.axisBreaks.x` in `plotWindows`, but that rebuilds with the CURRENT
  // channels; carrying the cache keeps the gesture's own channel binding
  // (`BreakComposition.source`) across undo/redo. Held by reference (no
  // copy); built from this same snapshot's datasets/view.
  carriedComposition: BreakComposition | SpatialComposition | null;
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
    analysisResults: s.analysisResults,
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
    mapViews: s.mapViews,
    quickPlotTemplates: s.quickPlotTemplates,
    plotRecipes: s.plotRecipes,
    collections: s.collections,
    fitModelCarry: s.fitModelCarry,
    macroSteps: s.macroSteps,
    techniqueViewMemory: s.techniqueViewMemory,
    plotWindows: s.plotWindows,
    focusedWindowId: s.focusedWindowId,
    view: snapshotView(s),
    carriedComposition:
      s.composition?.kind === "break" || s.composition?.kind === "spatial" ? s.composition : null,
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
  const { view, carriedComposition, ...fields } = snap;
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
    expandedFolders: restoredExpandedFolders(s, snap),
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
      // One live-entity pool per kind (typed exhaustive): a lookup table, not
      // a ternary chain, so each new artifact kind costs one entry.
      const pools: Record<LibrarySelection["kind"], readonly { id: string }[]> = {
        folder: snap.folders,
        workbook: snap.workbooks,
        "origin-figure": snap.originFigures,
        "editable-figure": snap.editableFigures,
        "publication-figure": snap.figureDocs,
        page: snap.pages,
        report: snap.reports,
        "analysis-result": snap.analysisResults,
      };
      return hasId(pools[sel.kind], sel.id) ? sel : null;
    })(),
    plotWindows: snap.plotWindows.map((w) =>
      w.datasetId && !live.has(w.datasetId) ? { ...w, datasetId: null } : w,
    ),
    ...focusTransientReset(),
    // After the reset, which nulls `composition`: a snapshotted break or
    // spatial arrangement comes back.
    composition: carriedComposition,
    // UI open state outside the snapshot: close the viewer on a report the
    // restore removed (an undone "add report") rather than show nothing.
    openReportId: hasId(snap.reports, s.openReportId) ? s.openReportId : null,
    openAnalysisResultId: hasId(snap.analysisResults, s.openAnalysisResultId) ? s.openAnalysisResultId : null,
  };
}

/** Folder disclosure is view state, like zoom/pan above: a toggle records
 *  nothing, so undo/redo keep the LIVE expand state rather than one captured
 *  with an older edit. Two exceptions keep it coherent with the restored tree:
 *  a folder the restore brings back (an undone delete) reopens as the snapshot
 *  had it, and a folder the restore removes drops out (as `folderDeletePatch`
 *  prunes going forward). Returns an existing array when nothing differs. */
function restoredExpandedFolders(s: AppState, snap: HistorySnapshot): string[] {
  const liveFolders = new Set(s.folders.map((f) => f.id));
  const snapFolders = new Set(snap.folders.map((f) => f.id));
  const liveOpen = new Set(s.expandedFolders);
  const back = snap.expandedFolders.filter(
    (id) => liveOpen.has(id) || (snapFolders.has(id) && !liveFolders.has(id)),
  );
  const seen = new Set(back);
  const next = [
    ...back,
    ...s.expandedFolders.filter((id) => !seen.has(id) && !(liveFolders.has(id) && !snapFolders.has(id))),
  ];
  const same = (a: readonly string[]): boolean => a.length === next.length && a.every((id, i) => id === next[i]);
  return same(s.expandedFolders) ? s.expandedFolders : same(snap.expandedFolders) ? snap.expandedFolders : next;
}
