// Recent-projects history (P1.1 C4) — the "open/save a project" analogue of
// lib/recentFiles.ts's recent-imports history. A project entry always
// carries a PATH: unlike an imported dataset (which a browser upload can
// still record by name alone, for the picker-only reopen), a project only
// gets a Recent Projects entry when a native dialog produced a durable path
// to remember — a browser-mode save (a plain download, no path) records
// nothing, because there would be nothing to reopen from that entry anyway.
//
// Deliberately mirrors recentFiles.ts's shape and behaviour (storage key
// name pattern, cap, load/save/remove/clear) rather than inventing a second
// pattern for the same job; the one deliberate difference is WHAT an entry
// dedupes by — see addRecentProjectEntry's doc. store/recentProjects.ts is
// this module's store-layer counterpart (mirrors store/recents.ts); see that
// file's header for why it is a standalone Zustand store rather than a
// store/useApp.ts slice.

export interface RecentProject {
  name: string;
  /** The durable, native-dialog path. Always present — see the module doc
   *  on why a path-less entry is never recorded in the first place. */
  path: string;
  /** ISO timestamp of the most recent open/save. */
  at: string;
}

const KEY = "qz.recentProjects";
const MAX = 12;

/** Prepend `entry`, drop any prior entry with the same PATH (projects dedupe
 *  by path, not name — recentFiles.ts dedupes imports by name because two
 *  browser uploads sharing a name are the ordinary "re-imported the same
 *  file" case; a project's identity is its path, and renaming the file on
 *  disk should not spawn a duplicate Recent entry the next time it's
 *  reopened at the same location), and cap the list. Pure — does not touch
 *  storage. */
export function addRecentProjectEntry(
  list: RecentProject[],
  entry: RecentProject,
  max = MAX,
): RecentProject[] {
  const deduped = list.filter((r) => r.path !== entry.path);
  return [entry, ...deduped].slice(0, max);
}

/** Read the recent-projects list (empty on absent / unreadable / malformed
 *  slot). */
export function loadRecentProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (r): r is RecentProject =>
        !!r &&
        typeof r === "object" &&
        typeof (r as RecentProject).name === "string" &&
        typeof (r as RecentProject).path === "string",
    );
  } catch {
    return [];
  }
}

/** Persist the recent-projects list (guarded against quota / private-mode
 *  failures, same as recentFiles.ts's saveRecent). */
export function saveRecentProjects(list: RecentProject[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — recents are best-effort */
  }
}

/** Drop one entry by path. Distinct from clearing the whole list — a single
 *  stale/relocated project should be removable without wiping every other
 *  entry. */
export function removeRecentProjectEntry(list: RecentProject[], path: string): RecentProject[] {
  return list.filter((r) => r.path !== path);
}

/** Wipe the recent-projects list. */
export function clearRecentProjectsMeta(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
