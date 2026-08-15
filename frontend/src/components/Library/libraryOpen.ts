// The single "open a Library node" dispatcher (LIBRARY_WORKBOOK_UX_PLAN PR
// C). Every open path in the tree — a workbook's remembered-child open
// (L0.6), a light artifact row's click, and the tree container's Enter key —
// funnels through `openLibraryNode` so there is exactly one definition of
// what "open" means per kind, and exactly one place that records L0.6's
// workbookLastChild. DatasetRow/FigureRow are REUSED components that predate
// this hierarchy and don't carry a LibraryNode, so they call
// `recordWorkbookOpen` directly alongside their own existing open action
// instead of routing through here — see their own onClick/onRowClick.

import type { LibraryNode } from "../../lib/libraryHierarchy";
import { useApp } from "../../store/useApp";

/** Record L0.6's remembered child for `workbookId` — a no-op when the node
 *  isn't nested under a workbook (undefined). Shared by every open path so a
 *  child opened from anywhere in the Library (tree, search, elsewhere)
 *  updates the same remembered-child map. */
export function recordWorkbookOpen(workbookId: string | undefined, key: string): void {
  if (!workbookId) return;
  useApp.getState().setWorkbookLastChild(workbookId, key);
}

/** The workbook id a node is nested under, or undefined when it isn't a
 *  workbook child (a folder/root-level item, or a cross-workbook artifact
 *  placed at a shared folder per L0.44). */
function owningWorkbookId(node: LibraryNode): string | undefined {
  return node.parentKey?.startsWith("workbook:") ? node.parentKey.slice("workbook:".length) : undefined;
}

/** L0.6: open a workbook's remembered child, or its first worksheet (source
 *  order — the hierarchy already sorts children) for a workbook with no
 *  remembered child yet. A childless workbook has nothing to open. */
function openWorkbookRemembered(node: Extract<LibraryNode, { kind: "workbook" }>): void {
  const lastKey = useApp.getState().workbookLastChild[node.entityId];
  const target = node.children.find((c) => c.key === lastKey) ?? node.children.find((c) => c.kind === "worksheet");
  if (target) openLibraryNode(target);
}

/** Open one Library node per its kind. Folders toggle expansion (they have no
 *  separate "open"); every other kind performs its canonical open action and
 *  records L0.6 for its owning workbook, if any. */
export function openLibraryNode(node: LibraryNode): void {
  const s = useApp.getState();
  if (node.kind === "folder") {
    s.toggleFolderExpanded(node.entityId);
    return;
  }
  if (node.kind === "workbook") {
    openWorkbookRemembered(node);
    return;
  }
  switch (node.kind) {
    case "worksheet":
      s.activateFromLibrary(node.entityId);
      break;
    case "origin-figure":
      s.applyOriginFigure(node.entityId);
      break;
    case "editable-figure":
      s.openEditableFigure(node.entityId);
      break;
    case "publication-figure":
      s.openFigureDoc(node.entityId);
      break;
    case "page":
      s.openPageDocument(node.entityId);
      break;
    case "report":
      s.setOpenReport(node.entityId);
      break;
  }
  recordWorkbookOpen(owningWorkbookId(node), node.key);
}
