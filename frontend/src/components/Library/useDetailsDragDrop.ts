// L1.4 drag/drop parity for the Details renderer (LIBRARY_WORKBOOK_UX_PLAN).
//
// The Tree's drag contract, which this reuses verbatim rather than restating:
//   * The dataTransfer TYPES are `dnd.ts`'s three (`FOLDER_DND`,
//     `WORKBOOK_DND`, `DATASET_DND`) — so a Details drag and a Tree drag are
//     indistinguishable to every existing drop target (a Details worksheet
//     can be dropped on a plot window exactly like a Tree one, and a Details
//     workbook can be dropped on a TREE folder row).
//   * A drag may only start from the dedicated `.qzk-drag-handle` grip
//     (GUI_INTERACTION #13 sub-item 1) — never the row body, whose click is
//     select and whose double-click is open.
//   * `activeDrag` is published so every legal drop target can light up
//     (#3 sub-item 2b).
//   * The MOVE itself is `moveFolder` / `moveWorkbookToFolder` — the same two
//     store actions `FolderRow`'s drop and the "Move to …" menu items call.
//     There is no Details-specific move path.
//
// Two deliberate differences from `FolderRow`'s drop target, both forced by
// what a Details table IS:
//   1. "Into" only — no above/below reposition zones. Details is a FLAT,
//      user-sortable projection whose sort never mutates canonical manual
//      order (PR D), so "drop above this row" has no stable meaning to
//      commit; offering it would write a manual reorder the visible order
//      does not reflect. Reposition stays a Tree gesture.
//   2. A WORKSHEET is a drag source but never a drop target, because folder
//      placement is owned by the WORKBOOK, not by any one worksheet's own
//      `folderId` (see dnd.ts's WORKBOOK_DND note). Its drag is the
//      plot-target `DATASET_DND` the Tree row publishes, not a move.

import { useState } from "react";

import { DATASET_DND, FOLDER_DND, WORKBOOK_DND } from "./dnd";
import { isSelfOrDescendant } from "../../lib/foldertree";
import type { LibraryNode } from "../../lib/libraryHierarchy";
import { useApp } from "../../store/useApp";
import { useLibraryStore } from "../../store/hooks/useLibraryStore";
import type { ActiveDrag } from "../../store/libraryPanel";

/** The dataTransfer type a node kind drags as, paired with the `activeDrag`
 *  kind it publishes — or null when the kind has no drag source in the Tree
 *  either (folders/workbooks/worksheets do; the five artifact kinds do not,
 *  so Details offers no grip for them). A worksheet publishes
 *  `kind: "dataset"` because `ActiveDrag` predates the hierarchy's
 *  "worksheet" naming (store/libraryPanel.ts). */
function dragSourceOf(node: LibraryNode): { type: string; drag: ActiveDrag["kind"] } | null {
  if (node.kind === "folder") return { type: FOLDER_DND, drag: "folder" };
  if (node.kind === "workbook") return { type: WORKBOOK_DND, drag: "workbook" };
  if (node.kind === "worksheet") return { type: DATASET_DND, drag: "dataset" };
  return null;
}

export interface DetailsDragDrop {
  /** Props for the row's `.qzk-drag-handle` grip, or null when this kind has
   *  no drag source. */
  handleProps: {
    draggable: true;
    onDragStart: (event: React.DragEvent) => void;
    onDragEnd: () => void;
    onClick: (event: React.MouseEvent) => void;
  } | null;
  /** Props for the row itself as a drop target — empty for every kind but
   *  folder, and inert for a folder that is not a legal destination. */
  rowProps: {
    onDragOver?: (event: React.DragEvent) => void;
    onDragLeave?: () => void;
    onDrop?: (event: React.DragEvent) => void;
  };
  /** True while a legal drag is hovering THIS folder row — the caller adds
   *  the same `drop-candidate` class FolderRow uses. */
  dropActive: boolean;
}

export function useDetailsDragDrop(node: LibraryNode): DetailsDragDrop {
  const setActiveDrag = useLibraryStore((s) => s.setActiveDrag);
  const activeDrag = useLibraryStore((s) => s.activeDrag);
  // Subscribed, not read imperatively: `legalDrag` below is computed IN THE
  // RENDER BODY, so a `getState()` read would freeze the folder tree at the
  // render that happened to precede the drag (architecture.test.ts's
  // getState()-in-render ratchet). `folders`/the two move actions are stable
  // identities between folder mutations, so this adds no rerenders in
  // practice.
  const folders = useApp((s) => s.folders);
  const moveFolder = useApp((s) => s.moveFolder);
  const moveWorkbookToFolder = useApp((s) => s.moveWorkbookToFolder);
  const [dropActive, setDropActive] = useState(false);

  const source = dragSourceOf(node);
  const handleProps = source
    ? {
        draggable: true as const,
        onDragStart: (event: React.DragEvent): void => {
          event.stopPropagation();
          event.dataTransfer.setData(source.type, node.entityId);
          event.dataTransfer.effectAllowed = "move";
          setActiveDrag({ kind: source.drag, id: node.entityId });
        },
        onDragEnd: (): void => setActiveDrag(null),
        // The grip is not a select/open target (Tree convention).
        onClick: (event: React.MouseEvent): void => event.stopPropagation(),
      }
    : null;

  if (node.kind !== "folder") return { handleProps, rowProps: {}, dropActive: false };
  const folderId = node.entityId;

  // Only the drag KIND is readable during dragover (the payload is
  // drop-only), so legality for a folder-onto-folder drag is decided from
  // the store's published `activeDrag` — exactly how FolderRow decides
  // whether to light itself up. A workbook may land in any folder; a folder
  // may not land in itself or in its own descendant. `isSelfOrDescendant`
  // walks up from THIS folder and returns true the moment it meets the
  // dragged id, so the identity case (dropped on itself) is already covered
  // and needs no separate clause.
  const legalDrag =
    activeDrag != null
    && (activeDrag.kind === "workbook"
      || (activeDrag.kind === "folder" && !isSelfOrDescendant(folders, activeDrag.id, folderId)));

  return {
    handleProps,
    dropActive,
    rowProps: {
      onDragOver: (event: React.DragEvent): void => {
        const types = event.dataTransfer.types;
        if (!types.includes(WORKBOOK_DND) && !types.includes(FOLDER_DND)) return;
        if (!legalDrag) return;
        event.preventDefault();
        if (!dropActive) setDropActive(true);
      },
      onDragLeave: (): void => setDropActive(false),
      onDrop: (event: React.DragEvent): void => {
        setDropActive(false);
        if (event.dataTransfer.types.includes(WORKBOOK_DND)) {
          const id = event.dataTransfer.getData(WORKBOOK_DND);
          if (!id) return;
          event.preventDefault();
          event.stopPropagation();
          moveWorkbookToFolder(id, folderId);
          return;
        }
        if (event.dataTransfer.types.includes(FOLDER_DND)) {
          const draggedId = event.dataTransfer.getData(FOLDER_DND);
          // Dropped on itself, or on its own descendant: a no-op, NOT a
          // move — `moveFolder` would refuse the cycle, and silently
          // reparenting to something else would be worse than nothing.
          // (`isSelfOrDescendant` covers the identity case, see above.)
          if (!draggedId || isSelfOrDescendant(folders, draggedId, folderId)) return;
          event.preventDefault();
          event.stopPropagation();
          moveFolder(draggedId, folderId);
        }
      },
    },
  };
}
