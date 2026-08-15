// Cross-project Library renderer preference (LIBRARY_WORKBOOK_UX_PLAN PR D).
// Kept in its own tiny localStorage blob, like toolbar/interaction prefs:
// changing Tree/Details is personal UI preference, not project content and
// not an undoable edit. Tiles joins this union in PR E when that renderer is
// genuinely usable; D must not restore a mode it cannot render.

export type LibraryViewMode = "tree" | "details";

export const LIBRARY_VIEW_PREFS_KEY = "qz.libraryViewPrefs";
export const LIBRARY_VIEW_DEFAULT: LibraryViewMode = "tree";

export function loadLibraryViewMode(): LibraryViewMode {
  try {
    const value = JSON.parse(localStorage.getItem(LIBRARY_VIEW_PREFS_KEY) ?? "{}") as {
      mode?: unknown;
    };
    return value.mode === "tree" || value.mode === "details" ? value.mode : LIBRARY_VIEW_DEFAULT;
  } catch {
    return LIBRARY_VIEW_DEFAULT;
  }
}

export function saveLibraryViewMode(mode: LibraryViewMode): void {
  try {
    localStorage.setItem(LIBRARY_VIEW_PREFS_KEY, JSON.stringify({ mode }));
  } catch {
    // Storage may be unavailable in private/restricted contexts; the live
    // session still switches normally.
  }
}
