// Recent-imports history (#20, MATLAB "ddRecent"), persisted to localStorage so
// the File ▸ Recent menu survives reloads. A browser <input type=file> gives no
// persistent path/handle, so a recent entry can't silently re-open by path —
// clicking one just re-opens the import picker. This module is the pure list +
// storage layer (mirrors autosave.ts); the menu reads it from the store.

export interface RecentFile {
  name: string;
  /** Bytes, for the tooltip. */
  size: number;
  /** ISO timestamp of the most recent import. */
  at: string;
  /** MAIN_PLAN #31: the real source path, when one was knowable — i.e. the
   *  import came from a native desktop dialog rather than a browser upload.
   *  Present = this entry can REOPEN its target directly; absent = clicking it
   *  can only re-open the picker, which is the pre-#31 behaviour and remains
   *  correct for a browser, where no path exists to remember. */
  path?: string;
}

const KEY = "qz.recent";
const MAX = 12;

/** Prepend `entry`, drop any prior entry with the same name (so a re-import
 *  bubbles to the top), and cap the list. Pure — does not touch storage. */
export function addRecentEntry(list: RecentFile[], entry: RecentFile, max = MAX): RecentFile[] {
  const deduped = list.filter((r) => r.name !== entry.name);
  return [entry, ...deduped].slice(0, max);
}

/** Read the recent list (empty on absent / unreadable / malformed slot). */
export function loadRecent(): RecentFile[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (r): r is RecentFile =>
        !!r && typeof r === "object" && typeof (r as RecentFile).name === "string",
    );
  } catch {
    return [];
  }
}

/** Persist the recent list (guarded against quota / private-mode failures). */
export function saveRecent(list: RecentFile[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — recents are best-effort */
  }
}

/** Drop one entry by name (the per-row "Remove from recent" action). Pure —
 *  a stale entry should be removable without also being re-imported, and
 *  without nuking the whole list. */
export function removeRecentEntry(list: RecentFile[], name: string): RecentFile[] {
  return list.filter((r) => r.name !== name);
}

/** Wipe the recent list (the "Clear recent" menu item). */
export function clearRecentMeta(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Coarse "2m ago" / "yesterday" label for an ISO time, given `nowMs`. Pure so
 *  the bucketing is testable without a clock. */
export function relativeTime(at: string, nowMs: number): string {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}
