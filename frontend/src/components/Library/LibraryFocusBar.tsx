import type { LibraryNode } from "../../lib/libraryHierarchy";

interface Props {
  focusedNode: LibraryNode | null;
  focusPath: readonly LibraryNode[];
  searching: boolean;
  onFocus: (node: LibraryNode) => void;
  onShowAll: () => void;
}

/** Compact, session-only scope control for dense imported projects. */
export default function LibraryFocusBar({
  focusedNode, focusPath, searching, onFocus, onShowAll,
}: Props) {
  if (focusedNode) {
    return (
      <div className="qzk-library-focus" role="navigation" aria-label="Focused Library location">
        {searching && <span className="qzk-library-focus-search">Searching project</span>}
        <div className="qzk-library-focus-path">
          <button type="button" aria-label="Show all" onClick={onShowAll}>All</button>
          {focusPath.map((node, index) => (
            <span key={node.key}>
              <span aria-hidden="true">/</span>
              {index === focusPath.length - 1 ? (
                <strong title={node.name}>{node.name}</strong>
              ) : (
                <button type="button" title={`Focus on ${node.name}`} onClick={() => onFocus(node)}>{node.name}</button>
              )}
            </span>
          ))}
        </div>
      </div>
    );
  }
  return null;
}
