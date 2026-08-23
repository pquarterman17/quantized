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
   *  Ctrl+Z). Returns the number of datasets ACTUALLY updated — the live
   *  intersection of `ids` with the current dataset list, since a caller
   *  (LibraryDetails.tsx's batch-edit dialog) captures `ids` before an async
   *  confirm step during which every named dataset can be deleted/trashed.
   *  A no-op patch (every field absent/empty) OR a selection with zero live
   *  ids records NO history and mutates nothing — either would otherwise be
   *  a phantom undo entry an Ctrl+Z silently no-ops on (adversarial-review
   *  P2, pinned by datasetMeta.test.ts). Unknown ids among a live selection
   *  are silently skipped (no throw — the same degrade-on-stale-id
   *  convention every other id-keyed action here uses). */
  batchEditDatasetMetadata: (ids: readonly string[], patch: BatchMetadataPatch) => number;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export function createDatasetMetaSlice(set: SliceSet, get: SliceGet): DatasetMetaSlice {
  return {
    // P2-2 (Sol's Day-6 audit): every single-row action below computes its
    // effective change FIRST and bails before recordHistory on a no-op --
    // missing id, blank/duplicate/absent tag, or an unchanged value must
    // never push a phantom undo entry, the same discipline
    // batchEditDatasetMetadata already applies (and is tested for) just
    // below.
    setDatasetNotes: (id, notes) => {
      const d = get().datasets.find((x) => x.id === id);
      if (!d) return; // no such dataset -- nothing to record
      const next = notes.trim() ? notes : undefined;
      if (d.notes === next) return; // unchanged value -- no-op
      get().recordHistory("edit notes");
      set((s) => ({
        datasets: s.datasets.map((x) => (x.id === id ? { ...x, notes: next } : x)),
      }));
    },
    addDatasetTag: (id, tag) => {
      const t = tag.trim();
      if (!t) return; // blank tag -- no-op
      const d = get().datasets.find((x) => x.id === id);
      if (!d) return; // no such dataset -- nothing to record
      const tags = d.tags ?? [];
      if (tags.includes(t)) return; // duplicate tag -- no-op
      get().recordHistory("add tag");
      set((s) => ({
        datasets: s.datasets.map((x) => (x.id === id ? { ...x, tags: [...(x.tags ?? []), t] } : x)),
      }));
    },
    removeDatasetTag: (id, tag) => {
      const d = get().datasets.find((x) => x.id === id);
      if (!d || !d.tags || !d.tags.includes(tag)) return; // no such dataset / absent tag -- no-op
      get().recordHistory("remove tag");
      set((s) => ({
        datasets: s.datasets.map((x) => {
          if (x.id !== id || !x.tags) return x;
          const tags = x.tags.filter((v) => v !== tag);
          return { ...x, tags: tags.length ? tags : undefined };
        }),
      }));
    },
    setDatasetGroup: (id, group) => {
      const d = get().datasets.find((x) => x.id === id);
      if (!d) return; // no such dataset -- nothing to record
      const next = group.trim() ? group.trim() : undefined;
      if (d.group === next) return; // unchanged value -- no-op
      get().recordHistory("set group");
      set((s) => ({
        datasets: s.datasets.map((x) => (x.id === id ? { ...x, group: next } : x)),
      }));
    },
    batchEditDatasetMetadata: (ids, patch) => {
      const idSet = new Set(ids);
      const addTags = [...new Set((patch.addTags ?? []).map((t) => t.trim()).filter(Boolean))];
      const removeTags = new Set((patch.removeTags ?? []).map((t) => t.trim()).filter(Boolean));
      const touchesNotes = patch.notes !== undefined;
      const touchesGroup = patch.group !== undefined;
      if (idSet.size === 0 || (!touchesNotes && !touchesGroup && addTags.length === 0 && removeTags.size === 0)) {
        return 0;
      }
      // adversarial-review P2: `ids` is the selection at the moment the
      // caller opened its edit dialog — by the time it confirms, every
      // named dataset may already be gone (deleted/trashed mid-dialog). Bail
      // BEFORE recordHistory in that case too, exactly like the empty-patch
      // guard above — a zero-effect batch edit must never leave a phantom
      // undo entry.
      const liveCount = get().datasets.filter((d) => idSet.has(d.id)).length;
      if (liveCount === 0) return 0;
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
      return liveCount;
    },
  };
}
