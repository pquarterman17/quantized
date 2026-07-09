// Workspace autosave wiring, extracted from App.tsx (component-ceiling
// ratchet — org plan #10 direction): restore the autosaved library once on
// startup, then debounce-save whenever the persisted workspace slice changes.
// The storage half lives in lib/autosave; this hook is only the store bridge.

import { useEffect } from "react";

import { loadAutosave, saveAutosave } from "./lib/autosave";
import { useApp } from "./store/useApp";

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
      if (
        state.datasets === prev.datasets &&
        state.folders === prev.folders &&
        state.expandedFolders === prev.expandedFolders &&
        state.activeId === prev.activeId &&
        state.selectedIds === prev.selectedIds &&
        state.smartFolders === prev.smartFolders &&
        state.plotWindows === prev.plotWindows &&
        state.focusedWindowId === prev.focusedWindowId
      ) {
        return;
      }
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
