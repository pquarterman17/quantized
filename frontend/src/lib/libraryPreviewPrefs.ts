// Per-worksheet "inline preview expanded" state for the Library TREE's
// compact rows (UX-001). Same shape and rationale as libraryViewPrefs.ts —
// personal UI preference, not project content, so it lives in its own tiny
// localStorage blob rather than a Zustand slice or the persisted workspace.
// A row reads its own single membership test on mount rather than subscribing
// to a shared store, so expanding one row can never re-render its siblings.
//
// Review round (UX-001) fixed two things the first version got wrong, both
// stemming from the same false assumption that the stored set "stays small on
// its own":
//
//  1. IT WAS NEVER PRUNED. Ids accumulated forever — deleted datasets, and
//     every id from every project ever opened in this browser. Nothing here
//     can tell whether an id is still live (the module deliberately knows
//     nothing about the store), so instead the list is BOUNDED and ordered
//     most-recent-first: expanding evicts the oldest beyond the cap. A stale
//     id is harmless (it names a dataset that no longer renders) and now
//     cannot accumulate without limit.
//  2. EVERY ROW RE-PARSED THE WHOLE BLOB. With ~120 rows mounting at once
//     that was ~120 `JSON.parse`es of the same string. The parse is now cached
//     against the RAW STRING it came from: each call still does a cheap
//     `getItem`, but re-parses only when the stored text actually differs.
//     Caching on the raw string rather than on "have I read once" keeps the
//     cache correct for ANY external write — another tab, devtools, or a test
//     seeding storage directly — so no invalidation hook is needed and none of
//     those cases can read a stale value.

const KEY = "qz.libraryTreePreviewIds";

/** Most-recently-expanded first; entries beyond this are evicted on write.
 *  Generous enough that no realistic session loses a row it still cares
 *  about, small enough that the blob cannot grow without bound. */
const MAX_REMEMBERED = 200;

let cachedText: string | null = null;
let cachedIds: string[] = [];

function loadExpandedIds(): string[] {
  let text: string | null;
  try {
    text = localStorage.getItem(KEY);
  } catch {
    return [];
  }
  if (text === cachedText) return cachedIds;
  let ids: string[] = [];
  try {
    const raw: unknown = JSON.parse(text ?? "[]");
    if (Array.isArray(raw)) ids = raw.filter((x): x is string => typeof x === "string");
  } catch {
    ids = [];
  }
  cachedText = text;
  cachedIds = ids;
  return ids;
}

function saveExpandedIds(ids: string[]): void {
  const text = JSON.stringify(ids);
  cachedText = text;
  cachedIds = ids;
  try {
    localStorage.setItem(KEY, text);
  } catch {
    // Storage may be unavailable in private/restricted contexts. The cache
    // above already holds the new value, so the live session's expand/collapse
    // still works; it just won't survive a reload.
  }
}

export function isPreviewExpanded(datasetId: string): boolean {
  return loadExpandedIds().includes(datasetId);
}

export function setPreviewExpanded(datasetId: string, expanded: boolean): void {
  const without = loadExpandedIds().filter((id) => id !== datasetId);
  saveExpandedIds(expanded ? [datasetId, ...without].slice(0, MAX_REMEMBERED) : without);
}
