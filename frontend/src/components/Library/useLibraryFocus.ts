import { useEffect, useMemo, useState } from "react";

import { focusLibraryHierarchy } from "../../lib/libraryFocus";
import {
  flattenLibraryHierarchy,
  type FlatLibraryNode,
  type LibraryHierarchy,
  type LibraryNode,
  type LibraryNodeKey,
} from "../../lib/libraryHierarchy";
import { useApp } from "../../store/useApp";
import { useLibraryStore } from "../../store/hooks/useLibraryStore";

/** Session-only browse scope. It never changes entity ownership, selection,
 * import targeting, or the saved workspace. */
export function useLibraryFocus(hierarchy: LibraryHierarchy, allRows: FlatLibraryNode[]) {
  const expandedFolders = useApp((s) => s.expandedFolders);
  const toggleFolderExpanded = useApp((s) => s.toggleFolderExpanded);
  const expandedWorkbookIds = useLibraryStore((s) => s.expandedWorkbookIds);
  const toggleWorkbookExpanded = useLibraryStore((s) => s.toggleWorkbookExpanded);
  const selection = useLibraryStore((s) => s.librarySelection);
  const [focusKey, setFocusKey] = useState<LibraryNodeKey | null>(null);

  const focusedNode = focusKey ? hierarchy.byKey.get(focusKey) ?? null : null;
  const candidateNode = useMemo(() => {
    if (!selection || (selection.kind !== "folder" && selection.kind !== "workbook")) return null;
    return hierarchy.byKey.get(`${selection.kind}:${selection.id}` as LibraryNodeKey) ?? null;
  }, [hierarchy, selection]);
  const focusedHierarchy = useMemo(
    () => focusLibraryHierarchy(hierarchy, focusKey),
    [hierarchy, focusKey],
  );
  const rows = useMemo(() => {
    if (!focusKey || focusedHierarchy === hierarchy) return allRows;
    const expandedKeys = new Set<LibraryNodeKey>();
    for (const id of expandedFolders) expandedKeys.add(`folder:${id}`);
    for (const id of expandedWorkbookIds) expandedKeys.add(`workbook:${id}`);
    return flattenLibraryHierarchy(focusedHierarchy, expandedKeys);
  }, [allRows, expandedFolders, expandedWorkbookIds, focusKey, focusedHierarchy, hierarchy]);

  useEffect(() => {
    if (focusKey && !hierarchy.byKey.has(focusKey)) setFocusKey(null);
  }, [focusKey, hierarchy]);

  const focusOn = (node: LibraryNode): void => {
    if (node.kind === "folder" && node.children.length > 0 && !expandedFolders.includes(node.entityId)) {
      toggleFolderExpanded(node.entityId);
    }
    if (node.kind === "workbook" && node.children.length > 0 && !expandedWorkbookIds.includes(node.entityId)) {
      toggleWorkbookExpanded(node.entityId);
    }
    setFocusKey(node.key);
  };

  return {
    focusActive: Boolean(focusKey), focusedNode, candidateNode, focusOn,
    clearFocus: () => setFocusKey(null),
    hierarchy: focusKey ? focusedHierarchy : hierarchy,
    rows: focusKey ? rows : allRows,
  };
}
