// Per-worksheet "inline preview expanded" state for the Library TREE's
// compact rows (UX-001). Same shape and rationale as libraryViewPrefs.ts —
// personal UI preference, not project content, so it lives in its own tiny
// localStorage blob rather than a Zustand slice or the persisted workspace.
// Keyed by dataset id; a row reads its own single membership test on mount
// (cheap even at ~120 rows — the stored set itself stays small since most
// worksheets are never expanded) rather than subscribing to a shared store,
// so expanding one row can never re-render its siblings.

const KEY = "qz.libraryTreePreviewIds";

function loadExpandedIds(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function saveExpandedIds(ids: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Storage may be unavailable in private/restricted contexts; the live
    // session's expand/collapse still works, it just won't survive a reload.
  }
}

export function isPreviewExpanded(datasetId: string): boolean {
  return loadExpandedIds().has(datasetId);
}

export function setPreviewExpanded(datasetId: string, expanded: boolean): void {
  const ids = loadExpandedIds();
  if (expanded) ids.add(datasetId);
  else ids.delete(datasetId);
  saveExpandedIds(ids);
}
