// Workspace autosave wiring, extracted from App.tsx (component-ceiling
// ratchet — org plan #10 direction): restore the autosaved library once on
// startup, then debounce-save whenever the persisted workspace slice changes.
// The storage half lives in lib/autosave; this hook is only the store bridge.

import { useEffect } from "react";

import { loadAutosave, saveAutosave } from "./lib/autosave";
import { useApp, type AppState } from "./store/useApp";

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
  | "plotWindows"
  | "focusedWindowId"
  | "savedPlotSpecs"
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
    state.plotWindows === prev.plotWindows &&
    state.focusedWindowId === prev.focusedWindowId &&
    state.savedPlotSpecs === prev.savedPlotSpecs
  );
}

export function useWorkspaceAutosave(): void {
  const setStatus = useApp((s) => s.setStatus);

  // Restore the autosaved library once on startup (before any new import).
  useEffect(() => {
    const restored = loadAutosave();
    if (restored?.datasets.length) {
      useApp.getState().loadWorkspace(restored);
      const n = restored.datasets.length;
      setStatus(`restored ${n} dataset${n === 1 ? "" : "s"} from autosave`);
    }
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
        // snapshot points") — never persist `s.plotWindows` raw.
        if (!saveAutosave({ ...s, plotWindows: s.windowsForSave() })) {
          useApp.getState().setStatus("autosave skipped (storage full or unavailable)");
        }
      }, 800);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, []);
}
