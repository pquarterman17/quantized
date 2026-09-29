import type { LibraryNode } from "../../lib/libraryHierarchy";

interface Props {
  focusedNode: LibraryNode | null;
  candidateNode: LibraryNode | null;
  searching: boolean;
  onFocus: (node: LibraryNode) => void;
  onShowAll: () => void;
}

/** Compact, session-only scope control for dense imported projects. */
export default function LibraryFocusBar({ focusedNode, candidateNode, searching, onFocus, onShowAll }: Props) {
  if (focusedNode) {
    return (
      <div className="qzk-library-focus" role="status">
        <span title={focusedNode.name}>
          {searching ? "Searching all · focus: " : "Focused on "}<strong>{focusedNode.name}</strong>
        </span>
        <button type="button" onClick={onShowAll}>Show all</button>
      </div>
    );
  }
  if (!candidateNode || searching) return null;
  return (
    <button
      type="button"
      className="qzk-library-focus-offer"
      title={`Temporarily show only ${candidateNode.name} and its contents`}
      onClick={() => onFocus(candidateNode)}
    >
      Focus on <strong>{candidateNode.name}</strong>
    </button>
  );
}
