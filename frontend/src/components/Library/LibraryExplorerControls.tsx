import type { LibraryContentFilter } from "../../lib/libraryExplorer";
import type { LibraryNode, LibraryNodeKey } from "../../lib/libraryHierarchy";

interface Props {
  filter: LibraryContentFilter;
  count: number;
  canExpand: boolean;
  canCollapse: boolean;
  searching: boolean;
  focusActive: boolean;
  focusedKey: LibraryNodeKey | null;
  candidateNode: LibraryNode | null;
  onFilterChange: (filter: LibraryContentFilter) => void;
  onFocus: (node: LibraryNode) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

/** Dense-project controls kept on one compact row at normal Library widths. */
export default function LibraryExplorerControls({
  filter, count, canExpand, canCollapse, searching, focusActive, focusedKey, candidateNode,
  onFilterChange, onFocus, onExpandAll, onCollapseAll,
}: Props) {
  const canFocus = candidateNode != null && candidateNode.key !== focusedKey;
  const focusLabel = candidateNode
    ? focusActive ? `Focus selection: ${candidateNode.name}` : `Focus on ${candidateNode.name}`
    : "Select a folder, workbook, or worksheet to focus";
  return (
    <div className="qzk-library-explorer-controls" aria-label="Project explorer controls">
      <select
        className="qz-input"
        aria-label="Show item type"
        value={filter}
        onChange={(event) => onFilterChange(event.target.value as LibraryContentFilter)}
      >
        <option value="all">All items</option>
        <option value="data">Data</option>
        <option value="figures">Figures</option>
        <option value="reports">Reports</option>
      </select>
      <span className="qzk-library-explorer-count" aria-live="polite">{count} {searching ? "eligible" : "shown"}</span>
      <button
        type="button"
        className="qz-icon-btn"
        aria-label={focusLabel}
        title={candidateNode ? `Temporarily show only ${candidateNode.name} and its contents` : focusLabel}
        disabled={!canFocus}
        onClick={() => candidateNode && onFocus(candidateNode)}
      >
        ⌖
      </button>
      <button
        type="button"
        className="qz-icon-btn"
        aria-label="Expand all folders and workbooks in view"
        title="Expand all folders and workbooks in view"
        disabled={!canExpand}
        onClick={onExpandAll}
      >
        ＋
      </button>
      <button
        type="button"
        className="qz-icon-btn"
        aria-label="Collapse all folders and workbooks in view"
        title="Collapse all folders and workbooks in view"
        disabled={!canCollapse}
        onClick={onCollapseAll}
      >
        −
      </button>
    </div>
  );
}
