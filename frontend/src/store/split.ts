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
//   - formulas/channelRoles/channelTypes/errorRoles: copied verbatim. These
//     are COLUMN-indexed, and a row slice never changes the column layout
//     (same labels/units/count) — only which ROWS survive — so they stay
//     valid completely untouched. errorRoles needs the explicit `[]`-vs-
//     `undefined` distinction preserved (F5, SILENT_STATE_CORRUPTION_PLAN):
//     an empty array is the O1 "designations checked, no error columns"
//     marker (lib/originBookRoles.ts) that stops the label-guesser fallback
//     (`dataset.errorRoles ?? inferErrorBindings(...)`) — dropping the field
//     entirely on the child silently re-enables that guesser.
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
// RE-SPLIT REUSE (bug-hunt fix): before minting a new folder, look for an
// existing SIBLING folder under the same parent with the same name — a
// second split of the same source (a different tolerance, or just running
// it again) lands its children in the ORIGINAL folder instead of a second
// identically-named one next to it.
//
// P2.5 (transform safety): rows with no split value land in the "(other)"
// child — `lib/transformWarnings.analyzeSplit` names them in the dialog
// before the split and in every child's `transform_warnings` metadata (beside
// `worksheet_transform: "split"`). The action records a `transform` pipeline
// step (`{op: "split", col, tolerance}`, text identical to
// `lib/transformRun.transformStepText`) and returns the children's ids, which
// is what lets the pipeline replay continue on the first child.
//
// Undo scope: the shared edit snapshot includes datasets and the folder tree.
// Undoing this one transaction therefore restores the complete pre-split
// organization without leaving an empty folder artifact.

// LAZY ON PURPOSE (bundle ratchet). The action's whole body lives in
// ./splitRun.ts, loaded on the first split: splitting is strictly a
// post-user-action operation, which is exactly the case the eager-bundle
// ratchet says to defer. (It began with `lib/datasetsplit.ts` alone, ~3.5 kB
// of pure math this slice was the only eager consumer of; P2.5 moved the rest
// of the body — the child/folder/macro build, ~1.8 kB — to fund the Reshape &
// combine workshop's eager open flag.) `splitDatasetByColumn` was already
// `async` and every await lands BEFORE any `recordHistory`/`set`, so the
// slice's "build fully, swap once" contract is unchanged.
import type { AppState } from "./useApp";

export type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
export type SliceGet = () => AppState;

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
  splitDatasetByColumn: (id: string, col: number, tolerance?: number) => Promise<string[]>;
}

export function createSplitSlice(set: SliceSet, get: SliceGet): SplitSlice {
  return {
    splitDialogTargetId: null,
    openSplitDialog: (id) => set({ splitDialogTargetId: id }),
    closeSplitDialog: () => set({ splitDialogTargetId: null }),

    splitDatasetByColumn: async (id, col, tolerance) =>
      (await import("./splitRun")).runSplit(set, get, id, col, tolerance),
  };
}
