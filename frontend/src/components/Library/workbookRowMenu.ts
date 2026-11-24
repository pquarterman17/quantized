// The Library workbook row's context-menu item list — mirrors
// datasetRowMenu.ts/folderRowMenu.ts's shape: the fixed items come from
// lib/workbookContextActions.ts's registry; this builder only supplies the
// dynamic per-folder "Move to..." list (one entry per live folder, which
// can't be a fixed registry entry); the source and move families are submenus.

import {
  workbookCoreActions,
  workbookDeleteActions,
  workbookSourceActions,
  type WorkbookActionTarget,
} from "../../lib/workbookContextActions";
import { buildMenuItems } from "../../lib/contextActions";
import type { LibraryNode } from "../../lib/libraryHierarchy";
import { useApp } from "../../store/useApp";
import { joinGroups, submenuItem } from "./rowMenuGroups";
import type { ContextMenuItem } from "../overlays/ContextMenu";

export function buildWorkbookRowMenu(
  node: Extract<LibraryNode, { kind: "workbook" }>,
  onRename: () => void,
  onBrowse?: () => void,
  onOpen?: () => void,
  onStageOpen?: () => void,
  onFocus?: () => void,
): ContextMenuItem[] {
  const workbook = node.entity;
  const target: WorkbookActionTarget = { node, onRename, onBrowse, onOpen, onStageOpen };
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

  const core = (ids: string[]) => buildMenuItems(workbookCoreActions.filter((a) => ids.includes(a.id)), target);
  const source = (ids: string[]) => buildMenuItems(workbookSourceActions.filter((a) => ids.includes(a.id)), target);
  // UX audit 10, P1-7: the source family (one "Re-import" spelling) and the
  // per-folder move list each sit in one submenu; "Browse" is a Tiles-view
  // command, so it is offered only where it can run (no permanently dead row).
  return joinGroups(
    [
      ...(onFocus ? [{ label: "Focus on this workbook", run: onFocus } as ContextMenuItem] : []),
      ...core(["workbook.open", "workbook.quickPlot", "workbook.configureQuickPlot", "workbook.quickPlotWith"]),
      ...(onBrowse ? core(["workbook.browse"]) : []),
    ],
    core(["workbook.rename", "workbook.copy", "workbook.duplicate"]),
    [
      ...submenuItem("Source", [...core(["workbook.reimportAll", "workbook.reimportAvailable"]), ...source(["workbook.revealSource"])]),
      ...submenuItem("Move", moveItems),
      ...core(["workbook.combine"]),
      ...source(["workbook.properties"]),
    ],
    buildMenuItems(workbookDeleteActions, target),
  );
}
