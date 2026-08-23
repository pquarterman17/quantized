// Collection CRUD (LIBRARY_WORKBOOK_UX_PLAN PR L, L0.48/L0.49/L0.56) -- a
// standalone slice (useApp.ts has near-zero line-budget headroom; the
// store/datasetMeta.ts / store/quickPlotTemplates.ts convention). Mirrors
// the store's existing `addSmartFolder`/`updateSmartFolder`/
// `removeSmartFolder` shape exactly -- save / rename / re-query / delete,
// each ONE `recordHistory` call (Collection CRUD is an undoable project
// edit, the same class as a saved Quick Plot template or a smart folder).
// No membership state of its own -- lib/collections.ts's
// `collectionMembers` derives it fresh from the live hierarchy every
// render, so there is nothing here to keep in sync.

import type { Collection } from "../lib/collections";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

let _collectionSeq = 0;
const nextCollectionId = (): string => `col-${Date.now().toString(36)}-${++_collectionSeq}`;

export interface CollectionsSlice {
  /** Every named saved Collection (L0.48/L0.49). Round-trips through .dwk. */
  collections: Collection[];
  /** Blank name = no-op, no history entry. Returns the new Collection's id
   *  (null on the no-op). */
  addCollection: (name: string, query: string) => string | null;
  /** No-op for an unknown id or a blank name. Undoable. */
  renameCollection: (id: string, name: string) => void;
  /** Re-scope a saved search without touching its name -- kept as its own
   *  action (mirrors `updateSmartFolder`) since a Collection's whole value
   *  is its query. No-op for an unknown id. Undoable. */
  updateCollectionQuery: (id: string, query: string) => void;
  /** No-op for an unknown id. Deleting a Collection never touches its
   *  members -- it never held a membership list (see lib/collections.ts's
   *  header). Undoable. */
  removeCollection: (id: string) => void;
}

export function createCollectionsSlice(set: SliceSet, get: SliceGet): CollectionsSlice {
  return {
    collections: [],

    addCollection: (name, query) => {
      const nm = name.trim();
      if (!nm) return null;
      get().recordHistory("save Collection");
      const id = nextCollectionId();
      set((s) => ({ collections: [...s.collections, { id, name: nm, query: query.trim() }] }));
      return id;
    },

    renameCollection: (id, name) => {
      const nm = name.trim();
      if (!nm || !get().collections.some((c) => c.id === id)) return;
      get().recordHistory("rename Collection");
      set((s) => ({
        collections: s.collections.map((c) => (c.id === id ? { ...c, name: nm } : c)),
      }));
    },

    updateCollectionQuery: (id, query) => {
      if (!get().collections.some((c) => c.id === id)) return;
      get().recordHistory("edit Collection filter");
      set((s) => ({
        collections: s.collections.map((c) => (c.id === id ? { ...c, query: query.trim() } : c)),
      }));
    },

    removeCollection: (id) => {
      if (!get().collections.some((c) => c.id === id)) return;
      get().recordHistory("delete Collection");
      set((s) => ({ collections: s.collections.filter((c) => c.id !== id) }));
    },
  };
}
