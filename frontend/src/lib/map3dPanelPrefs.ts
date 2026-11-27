// Whether the Map toolbar's 3-D view panel is open (OG17). The panel floats over
// the scene and covers about half of it, so it starts CLOSED and remembers the
// last choice. Browser-local, like libraryViewPrefs.ts: a personal UI state, not
// project content, so it is never written to the `.dwk` and needs no
// forward-compat rung.

export const MAP3D_PANEL_PREFS_KEY = "qz.map3dPanel";

export function loadMap3dPanelOpen(): boolean {
  try {
    return (JSON.parse(localStorage.getItem(MAP3D_PANEL_PREFS_KEY) ?? "{}") as { open?: unknown }).open === true;
  } catch {
    return false;
  }
}

export function saveMap3dPanelOpen(open: boolean): void {
  try {
    localStorage.setItem(MAP3D_PANEL_PREFS_KEY, JSON.stringify({ open }));
  } catch {
    // Storage may be unavailable; the panel still opens and closes this session.
  }
}
