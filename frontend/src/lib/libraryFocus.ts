import type { LibraryHierarchy, LibraryNode, LibraryNodeKey } from "./libraryHierarchy";

/**
 * Return a hierarchy rooted at one folder or workbook. This is a presentation
 * scope only: entity ownership and the persisted project remain untouched.
 * Depths are rebased so every Library renderer can consume the result without
 * knowing that focus mode is active.
 */
export function focusLibraryHierarchy(
  hierarchy: LibraryHierarchy,
  focusKey: LibraryNodeKey | null,
): LibraryHierarchy {
  if (!focusKey) return hierarchy;
  const focus = hierarchy.byKey.get(focusKey);
  if (!focus || (focus.kind !== "folder" && focus.kind !== "workbook")) return hierarchy;

  const byKey = new Map<LibraryNodeKey, LibraryNode>();
  const clone = (node: LibraryNode, depth: number, parentKey: LibraryNodeKey | null): LibraryNode => {
    const children = node.children.map((child) => clone(child, depth + 1, node.key));
    const scoped = { ...node, depth, parentKey, children } as LibraryNode;
    byKey.set(scoped.key, scoped);
    return scoped;
  };
  const root = clone(focus, 0, null);
  return { roots: [root], byKey, warnings: hierarchy.warnings };
}
