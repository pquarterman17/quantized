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

// LIBRARY_WORKBOOK_UX_PLAN PR L / L0.56 — batch project-metadata edit. Every
// field is OPTIONAL and independently applied: `undefined` means "leave this
// field alone" for every selected dataset, while an explicit `""` for
// notes/group means "clear it" (mirrors setDatasetNotes/setDatasetGroup's own
// blank-clears convention below). `addTags`/`removeTags` are trimmed,
// deduplicated tag lists, applied the same way addDatasetTag/removeDatasetTag
// already do per-dataset. Deliberately the SAME field set as the single-row
// actions below and nothing from `Dataset.data`/`Dataset.raw` — batch edits
// are project metadata only, never a rewrite of the imported source (pinned
// by datasetMeta.test.ts).
export interface BatchMetadataPatch {
  notes?: string;
  group?: string;
  addTags?: string[];
  removeTags?: string[];
}

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
  /** Apply `patch` to every dataset in `ids` as ONE undo entry (L0.56 — never
   *  one recordHistory per dataset, so a batch edit undoes in a single
   *  Ctrl+Z). A no-op patch (every field absent/empty) records no history and
   *  mutates nothing. Unknown ids are silently skipped (no throw — the same
   *  degrade-on-stale-id convention every other id-keyed action here uses). */
  batchEditDatasetMetadata: (ids: readonly string[], patch: BatchMetadataPatch) => void;
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
    batchEditDatasetMetadata: (ids, patch) => {
      const idSet = new Set(ids);
      const addTags = [...new Set((patch.addTags ?? []).map((t) => t.trim()).filter(Boolean))];
      const removeTags = new Set((patch.removeTags ?? []).map((t) => t.trim()).filter(Boolean));
      const touchesNotes = patch.notes !== undefined;
      const touchesGroup = patch.group !== undefined;
      if (idSet.size === 0 || (!touchesNotes && !touchesGroup && addTags.length === 0 && removeTags.size === 0)) {
        return;
      }
      get().recordHistory("batch edit metadata"); // ONE entry for the whole selection (L0.56)
      set((s) => ({
        datasets: s.datasets.map((d) => {
          if (!idSet.has(d.id)) return d;
          let next = d;
          if (touchesNotes) next = { ...next, notes: patch.notes!.trim() ? patch.notes : undefined };
          if (touchesGroup) next = { ...next, group: patch.group!.trim() ? patch.group!.trim() : undefined };
          if (addTags.length > 0 || removeTags.size > 0) {
            const merged = [...(next.tags ?? [])];
            for (const t of addTags) if (!merged.includes(t)) merged.push(t);
            const filtered = merged.filter((t) => !removeTags.has(t));
            next = { ...next, tags: filtered.length ? filtered : undefined };
          }
          return next;
        }),
      }));
    },
  };
}
