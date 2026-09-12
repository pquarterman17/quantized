// L1.4 rename parity: ONE "rename this Library node" dispatcher, shared by
// every renderer's rename surface.
//
// Before this file the kind -> store-action mapping was written out twice —
// once in `libraryTileMenu.ts`'s three `renameDialog(...)` commit callbacks
// (folder/workbook/worksheet, used by Tiles) and once in
// `artifactContextActions.ts`'s `renameArtifact` (the five artifact kinds,
// used by Tree/Details/Tiles). Adding the Details renderer's inline rename
// editor would have made it three. Both call sites now delegate here, so
// "what does renaming an X actually call" has exactly one answer.
//
// This is dispatch only: it deliberately owns no policy. WHETHER a node may
// be renamed stays in the action registries (`artifact.rename`'s `enabled`
// gate keeps a recovered Origin figure's name source-managed), and the
// empty/whitespace-name check stays at each editor, which knows whether a
// blank field means "cancel" (inline editor: revert) or "no result"
// (modal dialog: dismissed).

import type { LibraryNode } from "./libraryHierarchy";
import { useApp } from "../store/useApp";

/** Apply `name` to `node`'s underlying entity through that kind's canonical
 *  store action. `origin-figure` is intentionally a no-op — its name comes
 *  from the source Origin project, which is why `artifact.rename` reports
 *  itself disabled for that kind rather than silently doing nothing. */
export function renameLibraryNode(node: LibraryNode, name: string): void {
  const state = useApp.getState();
  switch (node.kind) {
    case "folder":
      state.renameFolder(node.entityId, name);
      return;
    case "workbook":
      state.renameWorkbook(node.entityId, name);
      return;
    case "worksheet":
      state.renameDataset(node.entityId, name);
      return;
    case "editable-figure":
      state.renameEditableFigure(node.entityId, name);
      return;
    case "publication-figure":
      state.renameFigureDoc(node.entityId, name);
      return;
    case "page":
      state.renamePageDocument(node.entityId, name);
      return;
    case "report":
      state.renameReport(node.entityId, name);
      return;
    case "origin-figure":
      return;
  }
}
