import type { LibraryHierarchy, LibraryNode, LibraryNodeKey } from "./libraryHierarchy";

export type LibraryContentFilter = "all" | "data" | "figures" | "reports";

const CONTENT_KINDS: Record<Exclude<LibraryContentFilter, "all">, ReadonlySet<LibraryNode["kind"]>> = {
  data: new Set(["worksheet", "analysis-result"]),
  figures: new Set(["origin-figure", "editable-figure", "publication-figure", "page"]),
  reports: new Set(["report"]),
};

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
    const container = node.kind === "folder" || node.kind === "workbook";
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

export function libraryNodeCount(hierarchy: LibraryHierarchy): number {
  return hierarchy.byKey.size;
}

export function libraryContainerIds(hierarchy: LibraryHierarchy): { folders: Set<string>; workbooks: Set<string> } {
  const folders = new Set<string>();
  const workbooks = new Set<string>();
  for (const node of hierarchy.byKey.values()) {
    if (node.kind === "folder") folders.add(node.entityId);
    if (node.kind === "workbook") workbooks.add(node.entityId);
  }
  return { folders, workbooks };
}
