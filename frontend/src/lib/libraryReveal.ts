// Disclose every collapsed ancestor of a Library node (folder, workbook or
// derived origin-group) so the node's row exists in the Tree. One definition
// for "Show in Library" and the Details/Tiles -> Tree switch, which both need
// it. Idempotent: it only opens, never collapses.

import { useApp } from "../store/useApp";
import type { LibraryHierarchy, LibraryNodeKey } from "./libraryHierarchy";

export function expandLibraryAncestors(hierarchy: LibraryHierarchy, key: LibraryNodeKey): void {
  const s = useApp.getState();
  const disclosure = {
    folder: [s.expandedFolders, s.toggleFolderExpanded],
    workbook: [s.expandedWorkbookIds, s.toggleWorkbookExpanded],
    "origin-group": [s.expandedOriginGroupIds, s.toggleOriginGroupExpanded],
  } as const;
  let parentKey = hierarchy.byKey.get(key)?.parentKey;
  while (parentKey) {
    const parent = hierarchy.byKey.get(parentKey);
    if (!parent) break;
    const [open, toggle] = (disclosure as Record<string, readonly [string[], (id: string) => void] | undefined>)[parent.kind] ?? [];
    if (open && !open.includes(parent.entityId)) toggle?.(parent.entityId);
    parentKey = parent.parentKey;
  }
}
