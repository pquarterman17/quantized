// PR E-b1: adapt Tile workspace targets to the SAME menu builders used by
// Tree rows. This file owns only target plumbing and modal editor fallbacks;
// action labels, gating, confirmation, and execution remain canonical in the
// existing dataset/workbook/folder registries.

import { askParams } from "../overlays/ParamDialog";
import type { ContextMenuItem } from "../overlays/ContextMenu";
import type { LibraryNode } from "../../lib/libraryHierarchy";
import { useApp } from "../../store/useApp";
import { buildDatasetRowMenu } from "./datasetRowMenu";
import { buildFolderRowMenu } from "./folderRowMenu";
import { buildWorkbookRowMenu } from "./workbookRowMenu";

export interface TileMenuHooks {
  browse: (node: LibraryNode) => void;
  open: (node: LibraryNode) => void;
}

function renameDialog(title: string, name: string, commit: (value: string) => void): void {
  void askParams(title, [{ key: "name", label: "Name", type: "text", default: name }]).then((result) => {
    const next = result && String(result.name).trim();
    if (next) commit(next);
  });
}

function tagDialog(id: string, name: string): void {
  void askParams(`Add tag to "${name}"`, [{ key: "tag", label: "Tag", type: "text", default: "" }]).then(
    (result) => {
      const tag = result && String(result.tag).trim();
      if (tag) useApp.getState().addDatasetTag(id, tag);
    },
  );
}

/** Null means this artifact kind intentionally waits for E-b2's shared
 * lifecycle registry; callers show an honest disabled menu in that slice. */
export function buildLibraryTileMenu(node: LibraryNode, hooks: TileMenuHooks): ContextMenuItem[] | null {
  const state = useApp.getState();
  if (node.kind === "worksheet") {
    const index = state.datasets.findIndex((dataset) => dataset.id === node.entityId);
    return buildDatasetRowMenu(
      node.entity,
      state.activeId === node.entityId,
      state.selectedIds.includes(node.entityId),
      state.folders,
      index > 0,
      index >= 0 && index < state.datasets.length - 1,
      () => renameDialog(`Rename "${node.name}"`, node.name, (name) => state.renameDataset(node.entityId, name)),
      () => tagDialog(node.entityId, node.name),
      hooks.open.bind(null, node),
    );
  }
  if (node.kind === "workbook") {
    return buildWorkbookRowMenu(node, () =>
      renameDialog(`Rename "${node.name}"`, node.name, (name) => state.renameWorkbook(node.entityId, name)),
    () => hooks.browse(node),
    () => hooks.open(node));
  }
  if (node.kind === "folder") {
    return buildFolderRowMenu(
      node.entity,
      node.children.length,
      () => renameDialog(`Rename "${node.name}"`, node.name, (name) => state.renameFolder(node.entityId, name)),
      () => hooks.browse(node),
    );
  }
  return null;
}
