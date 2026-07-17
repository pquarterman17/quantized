// The Library folder row's context-menu item list — extracted out of
// FolderRow.tsx the same way `datasetRowMenu.ts` was, and for the same
// reason: GUI_INTERACTION #8's shared `lib/contextActions.ts` folder
// registry now owns every item's label/gating/run, so this file is just the
// target-object plumbing (`FolderActionTarget`) plus the one call into
// `buildMenuItems`.

import { buildMenuItems, folderActions, type FolderActionTarget } from "../../lib/contextActions";
import type { FolderNode } from "../../lib/types";
import type { ContextMenuItem } from "../overlays/ContextMenu";

export function buildFolderRowMenu(
  folder: FolderNode,
  count: number,
  onRename: () => void,
  onExpand: () => void,
): ContextMenuItem[] {
  const target: FolderActionTarget = { folder, count, onRename, onExpand };
  return buildMenuItems(folderActions, target);
}
