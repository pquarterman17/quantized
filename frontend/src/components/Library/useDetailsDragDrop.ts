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
//   * `activeDrag` is published so every legal drop target can light up at
//     REST (#3 sub-item 2b), not only the one under the pointer: this hook
//     returns FolderRow's two cue classes with FolderRow's two meanings —
//     `drop-candidate` (dashed: this row would accept the drag in flight) on
//     every legal target, `dropinto` (solid: this is where it would land) on
//     the row actually hovered. shell.css carries the Details-scoped rules.
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
//
// Every store read lives in `useDetailsDragDropContext`, which the TABLE
// calls once and passes down (review round: the per-row hook held five
// subscriptions, so a 40-row window carried 200). The per-row hook keeps only
// its own hover flag.

import { useState } from "react";

import { DATASET_DND, FOLDER_DND, WORKBOOK_DND } from "./dnd";
import { isSelfOrDescendant } from "../../lib/foldertree";
import type { LibraryNode } from "../../lib/libraryHierarchy";
import type { FolderNode } from "../../lib/types";
import type { WorkbookNode } from "../../lib/workbooks";
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

export interface DetailsDragDropContext {
  activeDrag: ActiveDrag | null;
  setActiveDrag: (drag: ActiveDrag | null) => void;
  // Mutable, not `readonly`: `isSelfOrDescendant` takes `FolderNode[]`.
  folders: FolderNode[];
  /** Only `folderId` is read, and only at drop time, to refuse a move to the
   *  folder the workbook is already in. Subscribed (not `getState()`) because
   *  `getState()` anywhere under components/ counts against
   *  architecture.test.ts's getState()-in-render ratchet, which sits at its
   *  pin — and at ONE subscription for the whole table it is not worth a
   *  ratchet move. */
  workbooks: readonly WorkbookNode[];
  moveFolder: (id: string, newParentId: string | null, beforeId?: string) => void;
  moveWorkbookToFolder: (id: string, folderId: string | null) => void;
}

/** ONE subscription set for the whole table. `folders`/`workbooks` and
 *  `activeDrag` must be subscribed rather than read imperatively: legality is
 *  computed in the render body, and a `getState()` there would freeze the
 *  folder tree at the render that happened to precede the drag
 *  (architecture.test.ts's getState()-in-render ratchet). The two move
 *  actions are stable identities, so they add no rerenders. */
export function useDetailsDragDropContext(): DetailsDragDropContext {
  const setActiveDrag = useLibraryStore((s) => s.setActiveDrag);
  const activeDrag = useLibraryStore((s) => s.activeDrag);
  const folders = useApp((s) => s.folders);
  const workbooks = useApp((s) => s.workbooks);
  const moveFolder = useApp((s) => s.moveFolder);
  const moveWorkbookToFolder = useApp((s) => s.moveWorkbookToFolder);
  return { activeDrag, setActiveDrag, folders, workbooks, moveFolder, moveWorkbookToFolder };
}

export interface DetailsDragDrop {
  /** Props for the row's `.qzk-drag-handle` grip, or null when this kind has
   *  no drag source. */
  handleProps: {
    draggable: true;
    onDragStart: (event: React.DragEvent) => void;
    onDragEnd: () => void;
    onClick: (event: React.MouseEvent) => void;
    onDoubleClick: (event: React.MouseEvent) => void;
  } | null;
  /** Props for the row itself as a drop target — empty for every kind but
   *  folder, and inert for a folder that is not a legal destination. */
  rowProps: {
    onDragOver?: (event: React.DragEvent) => void;
    onDragLeave?: () => void;
    onDrop?: (event: React.DragEvent) => void;
  };
  /** The cue class this row should carry, or null — see the header note.
   *  `dropinto` beats `drop-candidate` on the hovered row, exactly as
   *  FolderRow's `isDropCandidate && !dropZone` guard arranges. */
  dropCue: "dropinto" | "drop-candidate" | null;
}

export function useDetailsDragDrop(node: LibraryNode, ctx: DetailsDragDropContext): DetailsDragDrop {
  const { activeDrag, setActiveDrag, folders, workbooks, moveFolder, moveWorkbookToFolder } = ctx;
  const [hovered, setHovered] = useState(false);

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
        // The grip is not a select/open target (Tree convention) — neither on
        // one click nor on two.
        onClick: (event: React.MouseEvent): void => event.stopPropagation(),
        onDoubleClick: (event: React.MouseEvent): void => event.stopPropagation(),
      }
    : null;

  if (node.kind !== "folder") return { handleProps, rowProps: {}, dropCue: null };
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
    dropCue: !legalDrag ? null : hovered ? "dropinto" : "drop-candidate",
    rowProps: {
      onDragOver: (event: React.DragEvent): void => {
        const types = event.dataTransfer.types;
        if (!types.includes(WORKBOOK_DND) && !types.includes(FOLDER_DND)) return;
        if (!legalDrag) return;
        event.preventDefault();
        if (!hovered) setHovered(true);
      },
      onDragLeave: (): void => setHovered(false),
      // Review round: this handler re-decides everything for itself. It never
      // consults `hovered` (the flag dragover sets), so a `drop` that arrives
      // with no preceding dragover — a synthetic event, or a browser that lost
      // it — is held to exactly the same rules; and it refuses a drop onto the
      // container the dragged node is ALREADY in, because both store actions
      // record their undo step BEFORE doing anything and a no-op move would
      // leave a do-nothing entry on the history stack.
      onDrop: (event: React.DragEvent): void => {
        setHovered(false);
        const types = event.dataTransfer.types;
        if (!types.includes(WORKBOOK_DND) && !types.includes(FOLDER_DND)) return;
        // The SAME predicate `onDragOver` applies, not a flag it set: with no
        // drag in flight (`activeDrag == null`) nothing is legal here.
        if (!legalDrag) return;
        if (types.includes(WORKBOOK_DND)) {
          const id = event.dataTransfer.getData(WORKBOOK_DND);
          if (!id) return;
          const workbook = workbooks.find((w) => w.id === id);
          if (!workbook || (workbook.folderId ?? null) === folderId) return;
          event.preventDefault();
          event.stopPropagation();
          moveWorkbookToFolder(id, folderId);
          return;
        }
        const draggedId = event.dataTransfer.getData(FOLDER_DND);
        // Dropped on itself, on its own descendant, or back into the parent it
        // already has: a no-op, NOT a move — `moveFolder` would refuse the
        // cycle (or reparent to where it already is) only after recording the
        // undo step. (`isSelfOrDescendant` covers the identity case, see
        // above; it is re-checked here against the PAYLOAD, which `activeDrag`
        // is not a substitute for.)
        if (!draggedId || isSelfOrDescendant(folders, draggedId, folderId)) return;
        const dragged = folders.find((f) => f.id === draggedId);
        if (!dragged || dragged.parentId === folderId) return;
        event.preventDefault();
        event.stopPropagation();
        moveFolder(draggedId, folderId);
      },
    },
  };
}
