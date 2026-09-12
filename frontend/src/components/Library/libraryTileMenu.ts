// PR E-b1: adapt Tile workspace targets to the SAME menu builders used by
// Tree rows. This file owns only target plumbing and modal editor fallbacks;
// action labels, gating, confirmation, and execution remain canonical in the
// existing dataset/workbook/folder registries.
//
// L1.4 (Details rename/move parity): the DETAILS renderer consumes this same
// builder too, so all three views compose one menu from one set of
// registries. Its only difference is the rename PROMPT — see
// `TileMenuHooks.rename` / `renamePrompt` below; the rename commit itself is
// `libraryRename.ts` for every view.

import { askParams } from "../overlays/ParamDialog";
import type { ContextMenuItem } from "../overlays/ContextMenu";
import { buildArtifactMenu, isArtifactNode } from "./artifactContextActions";
import { subtreeCount } from "../../lib/foldertree";
import type { LibraryNode } from "../../lib/libraryHierarchy";
import { useApp } from "../../store/useApp";
import { buildDatasetRowMenu } from "./datasetRowMenu";
import { buildFolderRowMenu } from "./folderRowMenu";
import { buildWorkbookRowMenu } from "./workbookRowMenu";
import { renameLibraryNode } from "../../lib/libraryRename";

export interface TileMenuHooks {
  browse: (node: LibraryNode) => void;
  open: (node: LibraryNode) => void;
  /** Close the workspace and return to the Stage AFTER an action that
   *  already performed its own plot-intent open (dataset.plot,
   *  plotInNewWindow, panels, plot-selected-together). Deliberately NOT
   *  `open`: re-dispatching openLibraryNode would route Origin-book
   *  datasets through activateFromLibrary's originBookClickOpens=
   *  "worksheet" detour, undoing setActive's unconditional plot intent. */
  stageReturn: () => void;
  /** L1.4 rename parity: override HOW the "Rename…" item collects the new
   *  name. Omitted (Tiles) = the modal `askParams` prompt below, unchanged.
   *  The Details renderer supplies its own inline row editor here, matching
   *  the Tree's "the menu opens an in-place input" convention. Either way
   *  the COMMIT goes through `renameLibraryNode`, so only the prompt
   *  differs — never which store action fires. */
  rename?: (node: LibraryNode) => void;
}

/** The default (Tiles) rename prompt: a modal name field committing through
 *  the shared `renameLibraryNode` dispatcher. `hooks.rename`, when supplied,
 *  replaces this prompt — never the dispatcher. */
function renamePrompt(node: LibraryNode, hooks: TileMenuHooks): () => void {
  const override = hooks.rename;
  if (override) return () => override(node);
  return () => {
    void askParams(`Rename "${node.name}"`, [
      { key: "name", label: "Name", type: "text", default: node.name },
    ]).then((result) => {
      const next = result && String(result.name).trim();
      if (next) renameLibraryNode(node, next);
    });
  };
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
      renamePrompt(node, hooks),
      () => tagDialog(node.entityId, node.name),
      hooks.stageReturn,
    );
  }
  if (node.kind === "workbook") {
    return buildWorkbookRowMenu(node, renamePrompt(node, hooks),
    () => hooks.browse(node),
    () => hooks.open(node),
    hooks.stageReturn);
  }
  if (node.kind === "folder") {
    // The SUBTREE dataset count, exactly what the tree passes (LibraryTree's
    // FolderRow) — the folder menu's "Select all (N)" gating and the
    // destructive "Delete folder + N dataset(s)" confirm state dataset
    // counts, not direct-child tile counts (a workbook child is 1 tile but
    // many datasets).
    return buildFolderRowMenu(
      node.entity,
      subtreeCount(state.folders, state.datasets, node.entityId),
      renamePrompt(node, hooks),
      () => hooks.browse(node),
    );
  }
  if (isArtifactNode(node)) return buildArtifactMenu(node, () => hooks.open(node));
  return null;
}
