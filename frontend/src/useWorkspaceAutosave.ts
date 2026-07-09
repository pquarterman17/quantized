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
      // saved smart-folder queries (org #9).
      if (
        state.datasets === prev.datasets &&
        state.folders === prev.folders &&
        state.expandedFolders === prev.expandedFolders &&
        state.activeId === prev.activeId &&
        state.selectedIds === prev.selectedIds &&
        state.smartFolders === prev.smartFolders
      ) {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!saveAutosave(useApp.getState())) {
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
