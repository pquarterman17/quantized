// Workspace autosave — persist the loaded library to localStorage so a reload
// restores it (manual .dwk save/load still exists for explicit, portable saves).
// Reuses the .dwk serializer; every call is guarded so a full/unavailable store
// (quota, private mode) degrades silently rather than throwing. Large libraries
// can exceed the ~5 MB quota — saveAutosave returns false so the caller can warn.

import { parseWorkspace, serializeWorkspace, type LoadedWorkspace, type WorkspaceState } from "./workspace";

const AUTOSAVE_KEY = "qz.autosave";

/** Persist the workspace incl. its folder tree (empty library → clear the slot).
 *  Returns false on quota/error. */
export function saveAutosave(ws: WorkspaceState): boolean {
  try {
    if (ws.datasets.length === 0) {
      localStorage.removeItem(AUTOSAVE_KEY);
      return true;
    }
    localStorage.setItem(AUTOSAVE_KEY, serializeWorkspace(ws));
    return true;
  } catch {
    return false; // quota exceeded / storage unavailable
  }
}

/** Restore the autosaved workspace, or null if absent / unreadable / malformed. */
export function loadAutosave(): LoadedWorkspace | null {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    if (!text) return null;
    const ws = parseWorkspace(text);
    return ws.datasets.length ? ws : null;
  } catch {
    return null; // corrupt slot — ignore rather than block startup
  }
}

/** Wipe the autosaved workspace (used by the "Clear autosaved workspace" action). */
export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}
