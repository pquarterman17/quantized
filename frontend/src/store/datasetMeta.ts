// Per-dataset metadata edits — free-text notes, tags, and the legacy `group`
// string (project-organization plan item 6 predates folders; `group` still
// round-trips a .dwk for a dataset that was never migrated into the folder
// tree). Extracted out of useApp.ts under the store-size ratchet
// (architecture.test.ts's STORE_PINS) to fund LIBRARY_WORKBOOK_UX_PLAN PR A2's
// `workbooks[]` field — the same self-contained-feature-out pattern as
// store/cellEdit.ts and store/corrections.ts. Owns no state of its own;
// `datasets` stays a plain field on the composed AppState, mutated through
// set/get like every other slice acting on shared state it does not own.

import type { AppState } from "./useApp";

export interface DatasetMetaSlice {
  // Attach free-text notes to a dataset (blank clears). Per-dataset, so it
  // lives on the object (round-trips through .dwk) rather than transient view state.
  setDatasetNotes: (id: string, notes: string) => void;
  // Add a trimmed, de-duplicated tag to a dataset (blank or duplicate = no-op).
  addDatasetTag: (id: string, tag: string) => void;
  // Remove a tag; the list drops to undefined when it empties (keeps .dwk clean).
  removeDatasetTag: (id: string, tag: string) => void;
  // Assign a dataset to a (trimmed) group; blank clears it back to Ungrouped.
  setDatasetGroup: (id: string, group: string) => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export function createDatasetMetaSlice(set: SliceSet, get: SliceGet): DatasetMetaSlice {
  return {
    setDatasetNotes: (id, notes) => {
      get().recordHistory("edit notes");
      set((s) => ({
        datasets: s.datasets.map((d) =>
          d.id === id ? { ...d, notes: notes.trim() ? notes : undefined } : d,
        ),
      }));
    },
    addDatasetTag: (id, tag) => {
      get().recordHistory("add tag");
      set((s) => {
        const t = tag.trim();
        if (!t) return {};
        return {
          datasets: s.datasets.map((d) => {
            if (d.id !== id) return d;
            const tags = d.tags ?? [];
            return tags.includes(t) ? d : { ...d, tags: [...tags, t] };
          }),
        };
      });
    },
    removeDatasetTag: (id, tag) => {
      get().recordHistory("remove tag");
      set((s) => ({
        datasets: s.datasets.map((d) => {
          if (d.id !== id || !d.tags) return d;
          const tags = d.tags.filter((x) => x !== tag);
          return { ...d, tags: tags.length ? tags : undefined };
        }),
      }));
    },
    setDatasetGroup: (id, group) => {
      get().recordHistory("set group");
      set((s) => ({
        datasets: s.datasets.map((d) =>
          d.id === id ? { ...d, group: group.trim() ? group.trim() : undefined } : d,
        ),
      }));
    },
  };
}
