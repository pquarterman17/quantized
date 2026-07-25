// The recent-imports slice (File ▸ Recent).
//
// Consolidated out of useApp.ts when MAIN_PLAN #31 gave Recent entries a real
// job: an entry imported through a native dialog now carries its source path
// and can REOPEN that file, instead of only re-opening the picker. That turned
// "recent" from a display list into a small model with add / remove / clear and
// a persistence format, which is enough to deserve its own home — and
// `removeRecent` had briefly landed in the import slice for expedience, which
// was the wrong place for it.
//
// Owns the `recent` state itself (unlike ./cellEdit or ./corrections, which
// mutate `datasets` through set/get). Nothing else writes it.
//
// The reopen DECISION — target present, missing, or merely offline — is not
// here: it lives in lib/reopenRecent.ts, pure and independent of the store, so
// the "an unmounted share is not a deleted file" rule can be tested on its own.

import {
  addRecentEntry,
  clearRecentMeta,
  loadRecent,
  removeRecentEntry,
  saveRecent,
  type RecentFile,
} from "../lib/recentFiles";
import type { AppState } from "./useApp";

export interface RecentsSlice {
  /** Recent-imports history, newest first; persisted via lib/recentFiles. */
  recent: RecentFile[];
  /** Record a successful import. `path` is set only where one was knowable
   *  (a native desktop pick) — a browser upload has none, and inventing one
   *  would promise a reopen we cannot deliver. */
  pushRecent: (name: string, size: number, path?: string) => void;
  /** Drop ONE entry. Distinct from `clearRecent`: a single stale entry should
   *  be removable without wiping the list, and without re-importing anything
   *  on the way out. */
  removeRecent: (name: string) => void;
  clearRecent: () => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export function createRecentsSlice(set: SliceSet): RecentsSlice {
  return {
    recent: loadRecent(),

    pushRecent: (name, size, path) =>
      set((s) => {
        const next = addRecentEntry(s.recent, {
          name,
          size,
          at: new Date().toISOString(),
          ...(path ? { path } : {}),
        });
        saveRecent(next);
        return { recent: next };
      }),

    removeRecent: (name) =>
      set((s) => {
        const next = removeRecentEntry(s.recent, name);
        saveRecent(next);
        return { recent: next };
      }),

    clearRecent: () => {
      clearRecentMeta();
      set({ recent: [] });
    },
  };
}
