// The Library workbook row's context-menu item list — mirrors
// datasetRowMenu.ts/folderRowMenu.ts's shape: the fixed items come from
// lib/workbookContextActions.ts's registry; this builder only supplies the
// dynamic per-folder "Move to..." list (one entry per live folder, which
// can't be a fixed registry entry) between Rename and Reveal Source.

import {
  workbookCoreActions,
  workbookDeleteActions,
  workbookSourceActions,
  type WorkbookActionTarget,
} from "../../lib/workbookContextActions";
import { buildMenuItems } from "../../lib/contextActions";
import type { LibraryNode } from "../../lib/libraryHierarchy";
import { useApp } from "../../store/useApp";
import type { ContextMenuItem } from "../overlays/ContextMenu";

export function buildWorkbookRowMenu(
  node: Extract<LibraryNode, { kind: "workbook" }>,
  onRename: () => void,
  onBrowse?: () => void,
  onOpen?: () => void,
): ContextMenuItem[] {
  const workbook = node.entity;
  const target: WorkbookActionTarget = { node, onRename, onBrowse, onOpen };
  const { folders, moveWorkbookToFolder } = useApp.getState();

  const moveItems: ContextMenuItem[] = [
    ...folders.map(
      (f): ContextMenuItem => ({
        label: `Move to "${f.name}"`,
        run: () => moveWorkbookToFolder(workbook.id, f.id),
        disabled: workbook.folderId === f.id,
      }),
    ),
    ...(workbook.folderId
      ? [{ label: "Move to top level", run: () => moveWorkbookToFolder(workbook.id, null) } as ContextMenuItem]
      : []),
  ];

  return [
    ...buildMenuItems(workbookCoreActions, target),
    ...(moveItems.length ? [{ separator: true } as ContextMenuItem, ...moveItems] : []),
    { separator: true },
    ...buildMenuItems(workbookSourceActions, target),
    { separator: true },
    ...buildMenuItems(workbookDeleteActions, target),
  ];
}
