// Library drag-and-drop dataTransfer types — extracted out of the retired
// useLibraryTree.ts (LIBRARY_WORKBOOK_UX_PLAN PR C) since these are drag
// plumbing, not view-model. The tree renderer itself now lives in
// LibraryTree.tsx / useLibraryHierarchyRows.ts, consuming lib/libraryHierarchy
// directly; this file is unchanged drag-source/target wiring only.

/** dataTransfer type for an internal dataset drag (row → folder, or row →
 *  drop-between-rows to reorder — GUI_INTERACTION_PLAN #13 item 3b). Distinct
 *  from an OS file drop, so the Library's file-import handler can ignore
 *  these. */
export const DATASET_DND = "application/x-qz-dataset";

/** dataTransfer type for an internal folder drag (folder header → folder
 *  header, for reparent/reposition — item 3b). Distinct from DATASET_DND so a
 *  drop target can tell a dragged folder from a dragged dataset without
 *  decoding the payload (only `types` is readable during dragover; the
 *  payload itself is only readable on drop). */
export const FOLDER_DND = "application/x-qz-folder";
