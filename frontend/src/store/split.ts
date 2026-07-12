// Split a dataset by a column's value into per-group child datasets
// (MAIN_PLAN #26) — "Split by column value…" on a DatasetRow's context menu
// + the Analyze-menu/⌘K command acting on the active dataset. Composed into
// the ONE useApp store instance exactly like ./reductions/./reimport (read
// windows.ts's header first): kept in its OWN file (not added to
// store/useApp.ts) because that module sits AT its architecture.test.ts
// size-ratchet pin with near-zero headroom — see store/reductions.ts's doc
// for the identical reasoning.
//
// The pure grouping/slicing math lives in lib/datasetsplit.ts (unit-tested
// there in isolation); this file is the thin store wrapper: resolve a
// still-pending Origin book first (duplicateDataset/mergeSelected
// precedent), mint one child Dataset per group, place them all in ONE new
// Library folder named after the source, and commit everything as a SINGLE
// recordHistory entry so undo restores the pre-split library in one step
// (duplicateDataset's precedent: build the whole patch, ONE `set()` call —
// never route through `addDataset` per group, which would each push its OWN
// history entry AND thrash activeId/selectedIds/the view-reset once per
// group instead of once for the whole batch).
//
// What carries to each child dataset, and why:
//   - data: SLICED to the group's rows (lib/datasetsplit.sliceDataStruct) —
//     the CURRENT (corrected) view, matching duplicateDataset's precedent of
//     cloning `src.data`, not `src.raw`.
//   - formulas/channelRoles/channelTypes: copied verbatim. These are
//     COLUMN-indexed, and a row slice never changes the column layout (same
//     labels/units/count) — only which ROWS survive — so they stay valid
//     completely untouched.
// What does NOT carry over, and why:
//   - excludedRows/filter: row-indexed/row-scoped state tied to the
//     SOURCE's row layout. After a slice, source row 47 might be row 3 of
//     one child and absent from every other one — the indices (and a
//     filter's implicit "these are the rows I was looking at") are
//     meaningless post-slice, same staleness class the #50/#53 precedent
//     (xTrim, reimportShapeChanged) already treats this way. A user
//     re-excludes/re-filters each child as needed.
//   - raw/corrections/bgRef: `data` already carries the corrected VALUES
//     baked in, but `raw` can have a DIFFERENT row count than `data` (an
//     xTrim correction drops rows from `data` while `raw` keeps every row)
//     — re-slicing `raw` by `data`'s row indices would silently misalign
//     the two. A child starts fresh/correction-free; its `data` already
//     reflects whatever correction was applied to the source.
//   - source/pending: re-import (`source`) re-reads the ORIGINAL file and
//     would restore every setpoint, silently undoing the split on the
//     child's next "Re-import from source"; a still-lazy Origin book
//     (`pending`) is resolved on the SOURCE before slicing (below), so no
//     child is ever minted from a `pending` preview in the first place.
//   - notes/tags/fitSpec: free-text/derived annotations about the SOURCE
//     sweep as a whole — not automatically true of any one setpoint's slice.
//
// Folder placement: MAIN_PLAN #26 says "a Library group named after the
// source" — `Dataset.group` is the RETIRED legacy field (lib/foldertree.ts's
// migrateGroupsToFolders doc: "nothing renders off this field anymore" —
// promoted into a folder on load and never read again); the live
// organizational model is the folder tree (`Dataset.folderId`), so "group"
// here means a FOLDER, nested under the source's own folder (or root) so
// the split doesn't relocate the family relative to the rest of the Library.
//
// Undo scope note: folder-tree mutations (createFolder et al.) are OUTSIDE
// the undo system everywhere in this codebase (store/useApp.ts's
// createFolder/moveDatasetToFolder never call recordHistory either) — the
// SAME precedent the DatasetRow "New folder with this…" entry already
// relies on. Undoing a split removes the child datasets (`datasets` IS
// snapshotted) but leaves the now-empty folder behind, exactly as undoing
// that existing entry would.

import { splitColumn, sliceDataStruct, tooManyGroups } from "../lib/datasetsplit";
import { createFolder as treeCreateFolder } from "../lib/foldertree";
import { nextStageTab } from "../lib/stagetab";
import type { Dataset } from "../lib/types";
import { toast } from "./toasts";
import { nextDatasetId, nextFolderId, type AppState } from "./useApp";
import { datasetViewDefaults, focusTransientReset } from "./windows";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export interface SplitSlice {
  /** The dataset id the "Split by column value…" dialog is open for, or
   *  null when closed. A specific id (not just a boolean) so the dialog can
   *  target a DatasetRow that ISN'T the active dataset without first
   *  rebinding the plot (mirrors `openReportId`'s shape). */
  splitDialogTargetId: string | null;
  openSplitDialog: (id: string) => void;
  closeSplitDialog: () => void;
  /** Split dataset `id` by column `col` (-1 = x, 0.. = a value channel —
   *  `ColumnFilter.col`'s convention) into one child dataset per group
   *  (`lib/datasetsplit.splitColumn`), all placed in one new folder named
   *  after the source. `tolerance` overrides the auto default for a
   *  continuous (gap-clustered) column; ignored for a categorical
   *  (exact-value) one. No-op (status + toast) if `id` doesn't exist, the
   *  column yields fewer than 2 groups (nothing to split), or it yields
   *  MORE than `SPLIT_GROUP_CAP` groups (almost certainly a mis-picked
   *  column — the dialog already warns before this is reachable, but the
   *  action re-checks so a direct/programmatic call can't bypass it). */
  splitDatasetByColumn: (id: string, col: number, tolerance?: number) => Promise<void>;
}

export function createSplitSlice(set: SliceSet, get: SliceGet): SplitSlice {
  return {
    splitDialogTargetId: null,
    openSplitDialog: (id) => set({ splitDialogTargetId: id }),
    closeSplitDialog: () => set({ splitDialogTargetId: null }),

    splitDatasetByColumn: async (id, col, tolerance) => {
      // A never-activated, still-pending Origin book only carries a small
      // downsampled preview (ORIGIN_FILE_DECODE_PLAN #38) — resolve the
      // full data first so the split groups the REAL rows, not a preview's.
      await get().resolveDataset(id);
      const src = get().datasets.find((d) => d.id === id);
      if (!src) return;

      const { groups } = splitColumn(src.data, col, tolerance);
      if (groups.length < 2) {
        toast(`"${src.name}" doesn't split into more than one group on that column`, "danger");
        return;
      }
      if (tooManyGroups(groups)) {
        toast(`too many groups (${groups.length}) — pick a different column or a wider tolerance`, "danger");
        return;
      }

      get().recordHistory("split dataset");
      const folderId = nextFolderId();
      const children: Dataset[] = groups.map((g) => {
        const child: Dataset = {
          id: nextDatasetId(),
          name: `${src.name} (${g.label})`,
          data: sliceDataStruct(src.data, g.rowIndexes),
          folderId,
        };
        if (src.formulas?.length) child.formulas = src.formulas.map((f) => ({ ...f }));
        if (src.channelRoles) child.channelRoles = { ...src.channelRoles };
        if (src.channelTypes) child.channelTypes = { ...src.channelTypes };
        return child;
      });
      const firstChild = children[0];

      set((s) => ({
        folders: treeCreateFolder(s.folders, src.folderId ?? null, src.name, folderId),
        datasets: [...s.datasets, ...children],
        activeId: firstChild.id,
        worksheetId: null,
        selectedIds: children.map((c) => c.id),
        stageTab: nextStageTab(firstChild, s.stageTab),
        ...datasetViewDefaults(firstChild),
        ...focusTransientReset(),
        expandedFolders: [...new Set([...s.expandedFolders, folderId])],
        splitDialogTargetId: null,
      }));

      get().setStatus(`split "${src.name}" into ${children.length} datasets`);
      toast(`split into ${children.length} datasets`, "ok");
    },
  };
}
