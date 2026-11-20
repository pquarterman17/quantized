import { useEffect, useMemo, useState } from "react";

import { focusLibraryHierarchy } from "../../lib/libraryFocus";
import {
  filterLibraryHierarchy,
  libraryContainerIds,
  type LibraryContentFilter,
} from "../../lib/libraryExplorer";
import {
  collapsedSheetOf,
  flattenLibraryHierarchy,
  type FlatLibraryNode,
  expandedKeySet,
  type LibraryHierarchy,
  type LibraryNode,
  type LibraryNodeKey,
} from "../../lib/libraryHierarchy";
import { useApp } from "../../store/useApp";
import { useLibraryStore } from "../../store/hooks/useLibraryStore";

/** A workbook with something to disclose: children, but not the lone sheet a
 *  collapsed row already shows. */
const isExpandableWorkbook = (node: LibraryNode | undefined): boolean =>
  node != null && node.children.length > 0 && collapsedSheetOf(node) == null;

/** Session-only browse scope. It never changes entity ownership, selection,
 * import targeting, or the saved workspace. */
export function useLibraryFocus(
  hierarchy: LibraryHierarchy,
  allRows: FlatLibraryNode[],
  contentFilter: LibraryContentFilter,
) {
  const expandedFolders = useApp((s) => s.expandedFolders);
  const toggleFolderExpanded = useApp((s) => s.toggleFolderExpanded);
  const expandedWorkbookIds = useLibraryStore((s) => s.expandedWorkbookIds);
  const toggleWorkbookExpanded = useLibraryStore((s) => s.toggleWorkbookExpanded);
  const expandedOriginGroupIds = useLibraryStore((s) => s.expandedOriginGroupIds);
  const selection = useLibraryStore((s) => s.librarySelection);
  const selectedIds = useApp((s) => s.selectedIds);
  const [focusKey, setFocusKey] = useState<LibraryNodeKey | null>(null);

  const focusedNode = focusKey ? hierarchy.byKey.get(focusKey) ?? null : null;
  const candidateNode = useMemo(() => {
    let node = selection
      ? hierarchy.byKey.get(`${selection.kind}:${selection.id}` as LibraryNodeKey)
      : selectedIds.length === 1
        ? hierarchy.byKey.get(`worksheet:${selectedIds[0]}`)
        : undefined;
    while (node && node.kind !== "folder" && node.kind !== "workbook") {
      node = node.parentKey ? hierarchy.byKey.get(node.parentKey) : undefined;
    }
    return node ?? null;
  }, [hierarchy, selectedIds, selection]);
  const focusedHierarchy = useMemo(
    () => focusLibraryHierarchy(hierarchy, focusKey),
    [hierarchy, focusKey],
  );
  const displayHierarchy = useMemo(
    () => filterLibraryHierarchy(focusedHierarchy, contentFilter),
    [contentFilter, focusedHierarchy],
  );
  const projectHierarchy = useMemo(
    () => filterLibraryHierarchy(hierarchy, contentFilter),
    [contentFilter, hierarchy],
  );
  const focusPath = useMemo(() => {
    if (!focusedNode) return [];
    const path: LibraryNode[] = [];
    let node: LibraryNode | undefined = focusedNode;
    while (node) {
      path.unshift(node);
      node = node.parentKey ? hierarchy.byKey.get(node.parentKey) : undefined;
    }
    return path;
  }, [focusedNode, hierarchy]);
  const rows = useMemo(() => {
    if (!focusKey && contentFilter === "all") return allRows;
    return flattenLibraryHierarchy(displayHierarchy, expandedKeySet(expandedFolders, expandedWorkbookIds, expandedOriginGroupIds));
  }, [allRows, contentFilter, displayHierarchy, expandedFolders, expandedWorkbookIds, expandedOriginGroupIds, focusKey]);

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

  // Expansion commands operate only on branches represented by the current
  // type filter; hidden branches retain their disclosure state.
  const scopeContainers = useMemo(() => libraryContainerIds(displayHierarchy), [displayHierarchy]);
  const expandableFolders = useMemo(
    () => new Set([...scopeContainers.folders].filter((id) => hierarchy.byKey.get(`folder:${id}`)?.children.length)),
    [hierarchy, scopeContainers.folders],
  );
  const expandableWorkbooks = useMemo(
    () => new Set([...scopeContainers.workbooks].filter((id) => isExpandableWorkbook(hierarchy.byKey.get(`workbook:${id}`)))),
    [hierarchy, scopeContainers.workbooks],
  );
  const disclosures = [
    [expandableFolders, expandedFolders],
    [expandableWorkbooks, expandedWorkbookIds],
    [scopeContainers.originGroups, expandedOriginGroupIds],
  ] as const;
  const setAllExpanded = (expanded: boolean): void => {
    const next = (have: readonly string[], want: ReadonlySet<string>): string[] =>
      expanded ? [...new Set([...have, ...want])] : have.filter((id) => !want.has(id));
    useApp.setState((state) => ({
      expandedFolders: next(state.expandedFolders, expandableFolders),
      expandedWorkbookIds: next(state.expandedWorkbookIds, expandableWorkbooks),
      expandedOriginGroupIds: next(state.expandedOriginGroupIds, scopeContainers.originGroups),
    }));
  };
  const canExpand = disclosures.some(([want, have]) => [...want].some((id) => !have.includes(id)));
  const canCollapse = disclosures.some(([want, have]) => [...want].some((id) => have.includes(id)));

  return {
    focusActive: Boolean(focusKey), focusedNode, candidateNode, focusPath, focusOn,
    clearFocus: () => setFocusKey(null),
    hierarchy: displayHierarchy,
    projectHierarchy,
    rows,
    canExpand,
    canCollapse,
    expandAll: () => setAllExpanded(true),
    collapseAll: () => setAllExpanded(false),
  };
}
