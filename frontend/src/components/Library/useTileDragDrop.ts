// L1.4 drag/drop for the Tile workspace (LIBRARY_WORKBOOK_UX_PLAN).
//
// This module deliberately contains NO drag logic. The Details renderer's
// contract — `useDetailsDragDrop.ts` — is already view-agnostic: it decides
// what may be dragged from the node KIND and what may accept a drop from the
// store's published `activeDrag`, and it commits through the same
// `moveFolder` / `moveWorkbookToFolder` actions the Tree's FolderRow and every
// "Move to …" menu item call. A tile grid needs exactly those decisions and
// exactly those actions, so re-deriving them here would be a second action
// path — the thing L1.4 exists to prevent — dressed up as parity.
//
// What Tiles therefore inherits UNCHANGED (see useDetailsDragDrop.ts for the
// reasoning behind each):
//   * `dnd.ts`'s three dataTransfer types, so a tile drag and a Tree drag are
//     indistinguishable to every existing drop target.
//   * `.qzk-drag-handle` as the ONLY draggable element — the tile body keeps
//     its select-or-browse click and its open double-click.
//   * "Into" only. A tile grid has no above/below band to aim at any more
//     than a sortable Details table does, so reposition stays a Tree gesture.
//   * Folder tiles as the only drop targets; a worksheet tile is a drag
//     SOURCE (the plot-target `DATASET_DND` payload) but never a target,
//     because folder placement is owned by the WORKBOOK.
//   * The two cue classes with the Tree's two meanings — `drop-candidate`
//     (dashed) on every legal target at rest, `dropinto` (solid) on the one
//     under the pointer. shell.css carries the Tiles-scoped rules.
//   * Cancelling cleanly when a virtualized drag source unmounts mid-drag.
//
// The names are re-exported view-neutrally so the tile renderer never reads
// as if it were borrowing a Details-specific facility.

export {
  useDetailsDragDrop as useTileDragDrop,
  useDetailsDragDropContext as useTileDragDropContext,
} from "./useDetailsDragDrop";
export type {
  DetailsDragDrop as TileDragDrop,
  DetailsDragDropContext as TileDragDropContext,
} from "./useDetailsDragDrop";
