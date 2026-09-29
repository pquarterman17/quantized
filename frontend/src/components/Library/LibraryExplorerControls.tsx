import type { LibraryContentFilter } from "../../lib/libraryExplorer";

interface Props {
  filter: LibraryContentFilter;
  count: number;
  canExpand: boolean;
  canCollapse: boolean;
  searching: boolean;
  onFilterChange: (filter: LibraryContentFilter) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

/** Dense-project controls kept on one compact row at normal Library widths. */
export default function LibraryExplorerControls({
  filter, count, canExpand, canCollapse, searching, onFilterChange, onExpandAll, onCollapseAll,
}: Props) {
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
