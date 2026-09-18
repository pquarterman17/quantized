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
// The full contract — payload types, the drag-handle-only source, "into"-
// only drop zones, the two cue classes, and what ends a drag (including the
// named residual) — lives once, in `useDetailsDragDrop.ts`'s file header.
// Nothing here restates the rules themselves. The names are re-exported
// view-neutrally so the tile renderer never reads as if it were borrowing a
// Details-specific facility.

export {
  useDetailsDragDrop as useTileDragDrop,
  useDetailsDragDropContext as useTileDragDropContext,
} from "./useDetailsDragDrop";
export type {
  DetailsDragDrop as TileDragDrop,
  DetailsDragDropContext as TileDragDropContext,
} from "./useDetailsDragDrop";
