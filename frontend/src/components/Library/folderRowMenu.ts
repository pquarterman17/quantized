// The Library folder row's context-menu item list — extracted out of
// FolderRow.tsx the same way `datasetRowMenu.ts` was. GUI_INTERACTION #8's
// shared `lib/contextActions.ts` folder registry owns every FIXED item's
// label/gating/run; this file supplies the target-object plumbing
// (`FolderActionTarget`) plus the one genuinely dynamic block, mirroring
// `datasetRowMenu.ts`'s own per-folder "Move to …" list: the menu-path
// equivalent of dragging this folder's header onto another one
// (GUI_INTERACTION #3 sub-item 4 — folder reorder had no non-mouse path
// before this).

import {
  buildMenuItems,
  folderBulkActions,
  folderCoreActions,
  folderDeleteActions,
  type FolderActionTarget,
} from "../../lib/contextActions";
import { isSelfOrDescendant } from "../../lib/foldertree";
import type { FolderNode } from "../../lib/types";
import { useApp } from "../../store/useApp";
import type { ContextMenuItem } from "../overlays/ContextMenu";

export function buildFolderRowMenu(
  folder: FolderNode,
  count: number,
  onRename: () => void,
  onExpand: () => void,
): ContextMenuItem[] {
  const target: FolderActionTarget = { folder, count, onRename, onExpand };
  const { folders, moveFolder } = useApp.getState();

  // Move this folder under another one, or back to the top level — the
  // click path for the SAME reparent/reposition the folder-onto-folder drag
  // performs (FolderRow's 3-zone onDrop). Excludes the folder itself and any
  // of its own descendants (moveFolder's own cycle guard already rejects
  // those; hiding them here keeps the menu honest about what it actually
  // offers, matching datasetRowMenu's disabled-when-already-there rule).
  const candidates = folders.filter(
    (f) => f.id !== folder.id && !isSelfOrDescendant(folders, folder.id, f.id),
  );
  const moveItems: ContextMenuItem[] = [
    ...candidates.map(
      (f): ContextMenuItem => ({
        label: `Move to "${f.name}"`,
        run: () => moveFolder(folder.id, f.id),
        disabled: folder.parentId === f.id,
      }),
    ),
    ...(folder.parentId !== null
      ? [{ label: "Move to top level", run: () => moveFolder(folder.id, null) } as ContextMenuItem]
      : []),
  ];

  return [
    ...buildMenuItems(folderCoreActions, target),
    ...(moveItems.length ? [{ separator: true } as ContextMenuItem, ...moveItems] : []),
    { separator: true },
    ...buildMenuItems(folderBulkActions, target),
    { separator: true },
    ...buildMenuItems(folderDeleteActions, target),
  ];
}
