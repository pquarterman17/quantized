// Workspace autosave wiring, extracted from App.tsx (component-ceiling
// ratchet — org plan #10 direction): restore the autosaved library once on
// startup, then debounce-save whenever the persisted workspace slice changes.
// The storage half lives in lib/autosave; this hook is only the store bridge.

import { useEffect } from "react";

import { autosaveHealth, loadAutosave, saveAutosave } from "./lib/autosave";
import { installSessionMarker, priorSessionEnd } from "./lib/sessionMarker";
import { captureTechniqueView } from "./lib/techniqueViewMemory";
import { reportAutosaveHealth } from "./store/autosaveStatus";
import { toast } from "./store/toasts";
import { useApp, type AppState } from "./store/useApp";
import { stageWorkspaceRestore } from "./store/windowHydration";

/** Every store field serialized into a .dwk workspace. Keep this list in one
 * place so autosave cannot silently omit a newly-persisted artifact. */
export type AutosaveState = Pick<
  AppState,
  | "datasets"
  | "folders"
  | "activeId"
  | "selectedIds"
  | "expandedFolders"
  | "originFigures"
  | "smartFolders"
  | "reports"
  | "macroSteps"
  | "recalcMode"
  | "figureDocs"
  | "editableFigures"
  | "pages"
  | "plotWindows"
  | "focusedWindowId"
  | "savedPlotSpecs"
  // LIBRARY_WORKBOOK_UX_PLAN PR E2: the three Library-panel fields
  // store/libraryPanel.ts's header marks "transient, E2 owns persistence".
  | "librarySelection"
  | "workbookLastChild"
  | "expandedWorkbookIds"
>;

export function shouldAutosave(state: AutosaveState, prev: AutosaveState): boolean {
  return !(
    state.datasets === prev.datasets &&
    state.folders === prev.folders &&
    state.activeId === prev.activeId &&
    state.selectedIds === prev.selectedIds &&
    state.expandedFolders === prev.expandedFolders &&
    state.originFigures === prev.originFigures &&
    state.smartFolders === prev.smartFolders &&
    state.reports === prev.reports &&
    state.macroSteps === prev.macroSteps &&
    state.recalcMode === prev.recalcMode &&
    state.figureDocs === prev.figureDocs &&
    state.editableFigures === prev.editableFigures &&
    state.pages === prev.pages &&
    state.plotWindows === prev.plotWindows &&
    state.focusedWindowId === prev.focusedWindowId &&
    state.savedPlotSpecs === prev.savedPlotSpecs &&
    state.librarySelection === prev.librarySelection &&
    state.workbookLastChild === prev.workbookLastChild &&
    state.expandedWorkbookIds === prev.expandedWorkbookIds
  );
}

export function useWorkspaceAutosave(): void {
  const setStatus = useApp((s) => s.setStatus);

  // Restore the autosaved library once on startup (before any new import).
  useEffect(() => {
    // Async since #32 (IndexedDB has no sync mode). `cancelled` guards the
    // StrictMode double-invoke and an unmount mid-read — restoring into a
    // torn-down store would clobber whatever the user did in between.
    let cancelled = false;
    // Read how the PREVIOUS session ended before marking this one active —
    // installSessionMarker overwrites the flag.
    const priorEnd = priorSessionEnd();
    const teardown = installSessionMarker();
    void loadAutosave().then((restored) => {
      if (cancelled || !restored?.datasets.length) return;
      useApp.getState().loadWorkspace(restored);
      // P3.4 slice 4: same synchronous-tick staging fileCommands.ts's
      // open-workspace command uses — see stageWorkspaceRestore's doc.
      stageWorkspaceRestore(useApp.getState().plotWindows, useApp.getState().focusedWindowId);
      const n = restored.datasets.length;
      const what = `${n} dataset${n === 1 ? "" : "s"}`;
      // #32: restoring is unremarkable after an ordinary close, but after a
      // CRASH the user should be told — that is the case where the last few
      // seconds may be missing and the workspace is worth checking. Toast
      // only in that case, so the notice means something when it appears.
      if (priorEnd === "unclean") {
        setStatus(`recovered ${what} after an unexpected close`);
        toast(`Recovered ${what} after an unexpected close — check your latest edits`, "info");
      } else {
        setStatus(`restored ${what} from autosave`);
      }
    });
    return () => {
      cancelled = true;
      teardown();
    };
  }, [setStatus]);

  // Debounced autosave whenever the library changes (identity comparisons).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = useApp.subscribe((state, prev) => {
      // Persist on any change to the workspace slice — datasets OR the folder
      // tree / expansion / active / selection (all part of .dwk v2) / the
      // saved smart-folder queries (org #9) / the plot window layout
      // (MULTI_PLOT_PLAN item 7 — geometry/z/winState/dataset-binding changes
      // bump the `plotWindows` array reference; a focus switch bumps
      // `focusedWindowId`). A live-view-only edit on the focused window
      // WITHOUT any of those structural changes doesn't reset this debounce
      // by itself — same pre-existing tradeoff `figureDocs`/`reports`/
      // `macroSteps` already have here (this hook watches a curated subset,
      // not every persisted field); an explicit File ▸ Save always captures
      // the live view regardless, via `windowsForSave()` below.
      // The helper compares the complete serialized workspace slice, including
      // reports, figure docs, macro steps, Origin figures, and recalc mode.
      if (!shouldAutosave(state, prev)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const s = useApp.getState();
        // `windowsForSave()` freezes the FOCUSED window's live view into its
        // record first (the plan's "save is one of the three sanctioned
        // snapshot points") — never persist `s.plotWindows` raw. Item 5's
        // `captureTechniqueView` does the same freshening for the technique
        // memory map (workspaceIO.ts's explicit Save uses the identical call).
        const techniqueViewMemory = captureTechniqueView(
          s.datasets.find((d) => d.id === s.activeId),
          s,
          s.techniqueViewMemory,
        );
        void saveAutosave({ ...s, plotWindows: s.windowsForSave(), techniqueViewMemory }).then((ok) => {
          // #32: report through the store so the warning PERSISTS until the
          // next successful save, instead of a status line that scrolls away.
          reportAutosaveHealth(autosaveHealth());
          if (!ok) {
            useApp.getState().setStatus("autosave failed (storage full or unavailable)");
          }
        });
      }, 800);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, []);
}
