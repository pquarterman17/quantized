import { collapsedWorkbookCount, type LibraryHierarchy, type LibraryNode, type LibraryNodeKey } from "./libraryHierarchy";

export type LibraryContentFilter = "all" | "data" | "figures" | "reports";

const CONTENT_KINDS: Record<Exclude<LibraryContentFilter, "all">, ReadonlySet<LibraryNode["kind"]>> = {
  data: new Set(["worksheet", "analysis-result"]),
  figures: new Set(["origin-figure", "editable-figure", "publication-figure", "page"]),
  reports: new Set(["report"]),
};

/** Nodes that hold others and are browsed INTO (Tiles) / filtered by their
 *  contents rather than matched themselves. */
export function isContainerKind(kind: LibraryNode["kind"] | undefined): boolean {
  return kind === "folder" || kind === "workbook" || kind === "origin-group";
}

/**
 * Filter Library content without flattening its location. Folder/workbook
 * ancestors are retained only when they lead to a matching item, so a dense
 * Origin project stays understandable while irrelevant branches disappear.
 */
export function filterLibraryHierarchy(
  hierarchy: LibraryHierarchy,
  filter: LibraryContentFilter,
): LibraryHierarchy {
  if (filter === "all") return hierarchy;
  const accepted = CONTENT_KINDS[filter];
  const byKey = new Map<LibraryNodeKey, LibraryNode>();

  const visit = (node: LibraryNode, parentKey: LibraryNodeKey | null, depth: number): LibraryNode | null => {
    const children = node.children
      .map((child) => visit(child, node.key, depth + 1))
      .filter((child): child is LibraryNode => child != null);
    const container = isContainerKind(node.kind);
    if ((!container && !accepted.has(node.kind)) || (container && children.length === 0)) return null;
    const kept = { ...node, parentKey, depth, children } as LibraryNode;
    byKey.set(kept.key, kept);
    return kept;
  };

  const roots = hierarchy.roots
    .map((root) => visit(root, null, 0))
    .filter((root): root is LibraryNode => root != null);
  return { roots, byKey, warnings: hierarchy.warnings };
}

/** The "N shown" count: every node the view lists. `collapsed` (Tree/Tiles
 *  navigator) drops the workbooks that render as their sheet's row, so the
 *  count equals the rows the tree can show; Details lists all entities. */
export function libraryNodeCount(hierarchy: LibraryHierarchy, collapsed = false): number {
  return hierarchy.byKey.size - (collapsed ? collapsedWorkbookCount(hierarchy) : 0);
}

export function libraryContainerIds(
  hierarchy: LibraryHierarchy,
): { folders: Set<string>; workbooks: Set<string>; originGroups: Set<string> } {
  const folders = new Set<string>();
  const workbooks = new Set<string>();
  const originGroups = new Set<string>();
  for (const node of hierarchy.byKey.values()) {
    if (node.kind === "folder") folders.add(node.entityId);
    if (node.kind === "workbook") workbooks.add(node.entityId);
    if (node.kind === "origin-group") originGroups.add(node.entityId);
  }
  return { folders, workbooks, originGroups };
}
