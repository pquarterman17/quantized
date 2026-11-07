// The autosave trigger — which store fields a .dwk persists, and whether a
// store change touched any of them — moved verbatim out of
// useWorkspaceAutosave.ts (MAIN_PLAN #42) under that module's 500-line
// ceiling, so the new `savedSampleProfiles` entry gets its own commented
// lines instead of being packed onto a neighbour's. useWorkspaceAutosave.ts
// re-exports both names, so every importer is unchanged.

import type { AppState } from "./useApp";

/** Every store field serialized into a .dwk workspace. Keep this list in one
 * place so autosave cannot silently omit a newly-persisted artifact — its
 * test file's "AutosaveState completeness sweep" cross-checks it against
 * lib/workspace.ts's real WorkspaceDoc shape so this can't drift unnoticed. */
export type AutosaveState = Pick<
  AppState,
  | "datasets"
  | "folders"
  | "activeId"
  | "selectedIds"
  | "expandedFolders"
  | "originFigures"
  // P2-1 (adversarial review, 2026-08-18): `originFidelity` persists
  // (lib/workspace.ts) and mutates independently via
  // store/originImport.ts's `addOriginFidelity` — no other tracked field
  // necessarily changes alongside it.
  | "originFidelity"
  | "smartFolders"
  | "reports" | "analysisResults"
  | "macroSteps"
  | "recalcMode"
  | "figureDocs"
  | "editableFigures"
  | "pages"
  | "plotWindows"
  | "focusedWindowId"
  // P2-1: persists (lib/workspace.ts) and mutates independently via
  // store/toolwindows.ts's setToolWindowLayout/toggleToolWindowCollapsed/
  // resetToolWindowPositions — dragging or collapsing a tool window
  // previously left the dirty marker false and scheduled no autosave.
  | "toolWindowLayout"
  | "savedPlotSpecs"
  // P2-1: PR H's saved Quick Plot templates — persist, mutate independently
  // (store/quickPlotTemplates.ts), had no trigger here.
  | "quickPlotTemplates"
  // LIBRARY_WORKBOOK_UX_PLAN PR E2: the three Library-panel fields
  // store/libraryPanel.ts's header marks "transient, E2 owns persistence".
  | "librarySelection"
  | "workbookLastChild"
  | "expandedWorkbookIds"
  // Post-merge review fix: two more persisted fields with NO trigger here —
  // renameWorkbook/moveWorkbookToFolder only mutate `workbooks`, and saving/
  // deleting a named ROI only mutates `savedRois`, so either edit could sit
  // unsaved until some unrelated field also changed.
  | "workbooks"
  | "savedRois"
  // Audit P2.8: the per-dataset durable map views — persist (lib/workspace.ts)
  // and mutate on their own (store/mapView.ts's colour-limit/scale/colormap/
  // slice/annotation writers), so without a trigger here a colour limit typed
  // into the Inspector or a slice taken on the map left the title bar showing
  // clean right up to a crash. Same completeness-sweep class as `savedRois`
  // above. Merely OPENING a map is a pure lookup and changes nothing here.
  | "mapViews"
  // P2-1: PR L's saved-search Collections — persist, mutate independently
  // (store/collections.ts), had no trigger here. A Collection rename/save
  // left the title bar showing clean right up to a crash.
  | "collections"
  // PR L slice 2: the Details view's selected metadata columns — persist
  // (lib/workspace.ts), mutate independently (store/libraryDetailsColumns.ts),
  // same completeness-sweep class as collections/quickPlotTemplates above.
  | "visibleDetailsColumns"
  // P1.3 wave 2 integration fix (finding 2): saved Plot Recipes — persist
  // (lib/workspace.ts), mutate independently (store/plotRecipes.ts's
  // save/rename/delete/duplicate CRUD), same completeness-sweep class as
  // collections/quickPlotTemplates above. Was already serialized by the
  // whole-state-spread save path with no trigger here — a recipe CRUD edit
  // left the title bar showing clean right up to a crash.
  | "plotRecipes"
  // MAIN_PLAN #42: named sample profiles — persist (lib/workspace.ts), mutate
  // independently (store/sampleProfiles.ts), same class as `collections`.
  | "savedSampleProfiles"
  | "fitModelCarry" // P2.7: a refused fit-model merge grows it on its own (store/workspaceHydration.ts)
>;

export function shouldAutosave(state: AutosaveState, prev: AutosaveState): boolean {
  return !(
    state.datasets === prev.datasets &&
    state.folders === prev.folders &&
    state.activeId === prev.activeId &&
    state.selectedIds === prev.selectedIds &&
    state.expandedFolders === prev.expandedFolders &&
    state.originFigures === prev.originFigures &&
    state.originFidelity === prev.originFidelity &&
    state.smartFolders === prev.smartFolders &&
    state.reports === prev.reports && state.analysisResults === prev.analysisResults &&
    state.macroSteps === prev.macroSteps &&
    state.recalcMode === prev.recalcMode &&
    state.figureDocs === prev.figureDocs &&
    state.editableFigures === prev.editableFigures &&
    state.pages === prev.pages &&
    state.plotWindows === prev.plotWindows &&
    state.focusedWindowId === prev.focusedWindowId &&
    state.toolWindowLayout === prev.toolWindowLayout &&
    state.savedPlotSpecs === prev.savedPlotSpecs &&
    state.quickPlotTemplates === prev.quickPlotTemplates &&
    state.librarySelection === prev.librarySelection &&
    state.workbookLastChild === prev.workbookLastChild &&
    state.expandedWorkbookIds === prev.expandedWorkbookIds &&
    state.workbooks === prev.workbooks &&
    state.savedRois === prev.savedRois &&
    state.mapViews === prev.mapViews &&
    state.collections === prev.collections &&
    state.savedSampleProfiles === prev.savedSampleProfiles &&
    state.visibleDetailsColumns === prev.visibleDetailsColumns &&
    state.plotRecipes === prev.plotRecipes && state.fitModelCarry === prev.fitModelCarry
  );
}
