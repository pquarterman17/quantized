// Recoverable project trash (MAIN_PLAN #32): deleted datasets go here instead
// of straight to nothing.
//
// This is NOT a duplicate of undo. Undo is a session-scoped edit history that
// dies with the tab; trash is the answer to "I deleted that yesterday and only
// noticed today". Different guarantee, different lifetime.
//
// BOUNDED BY CONSTRUCTION, because #32 explicitly wants recovery storage that
// cannot grow forever: capped by entry count AND by age, evicted oldest-first
// on every send. The rules are pure functions so the eviction policy is
// testable without a store.
//
// Raw SOURCE FILES are never involved. Trash holds the in-memory Dataset
// records the app already had; nothing on disk is moved, renamed or deleted.

import type { Dataset } from "../lib/types";
import type { AppState } from "./useApp";

export interface TrashEntry {
  /** Epoch ms the entry was trashed. */
  at: number;
  dataset: Dataset;
}

/** Most a user plausibly wants to reach back through. */
export const TRASH_MAX_ENTRIES = 25;
/** Entries older than this are dropped on the next trash operation. */
export const TRASH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Apply both caps: drop anything past the age limit, then keep the newest N.
 *  Pure — `now` is passed in so tests never depend on the clock. */
export function evictTrash(
  entries: readonly TrashEntry[],
  now: number,
  maxEntries = TRASH_MAX_ENTRIES,
  maxAgeMs = TRASH_MAX_AGE_MS,
): TrashEntry[] {
  return entries
    .filter((e) => now - e.at <= maxAgeMs)
    .sort((a, b) => b.at - a.at)
    .slice(0, Math.max(0, maxEntries));
}

export interface TrashSlice {
  /** Trash panel visibility. Lives here rather than on useApp: it is trash's
   *  own UI state, and useApp sits at its size ratchet. */
  trashOpen: boolean;
  setTrashOpen: (trashOpen: boolean) => void;
  /** Newest first. Session-scoped: deliberately NOT serialized into a `.dwk`,
   *  which is a portable description of a workspace, not a wastebasket. */
  trash: TrashEntry[];
  /** Capture datasets on their way out of the library. */
  sendToTrash: (datasets: readonly Dataset[], now?: number) => void;
  /** Put one back. Returns false when the id is not in the trash. */
  restoreFromTrash: (id: string) => boolean;
  /** Permanently drop one entry, or the whole trash when `id` is omitted. */
  purgeTrash: (id?: string) => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export function createTrashSlice(set: SliceSet, get: SliceGet): TrashSlice {
  return {
    trash: [],
    trashOpen: false,
    setTrashOpen: (trashOpen) => set({ trashOpen }),

    sendToTrash: (datasets, now = Date.now()) => {
      if (datasets.length === 0) return;
      set((s) => ({
        trash: evictTrash([...datasets.map((d) => ({ at: now, dataset: d })), ...s.trash], now),
      }));
    },

    restoreFromTrash: (id) => {
      const entry = get().trash.find((e) => e.dataset.id === id);
      if (!entry) return false;
      // Restoring is itself an undoable edit — it changes the library.
      get().recordHistory("restore from trash");
      set((s) => ({
        // Guard against an id that came back some other way (a re-import, an
        // undo) while it was sitting in the trash: never create a duplicate.
        datasets: s.datasets.some((d) => d.id === id)
          ? s.datasets
          : [...s.datasets, entry.dataset],
        trash: s.trash.filter((e) => e.dataset.id !== id),
        activeId: s.activeId ?? id,
      }));
      return true;
    },

    purgeTrash: (id) =>
      set((s) => ({ trash: id ? s.trash.filter((e) => e.dataset.id !== id) : [] })),
  };
}
