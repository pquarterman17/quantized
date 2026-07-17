// Presentational toolbar for the Worksheet: the computed-column formula bar plus
// the Stats / Copy / Unmask actions, the row-selection (#50) bulk-action cluster,
// and (WORKSHEET_PLAN items 6+7) the column-selection "Plot selection"/"Add to
// plot" cluster. All state lives in the parent (Worksheet); this is a thin
// props-driven view so the worksheet stays under the size budget.

export interface WorksheetToolbarProps {
  formula: string;
  colName: string;
  setFormula: (v: string) => void;
  setColName: (v: string) => void;
  onAddColumn: () => void;
  showStats: boolean;
  onToggleStats: () => void;
  onCopy: () => void;
  maskedCount: number;
  onUnmaskAll: () => void;
  /** #50 selection dimension: bulk actions on the selected rows. */
  selectedCount: number;
  onExcludeSelected: () => void;
  onKeepOnlySelected: () => void;
  onClearSelection: () => void;
  vars: string;
  /** Column selection → plot (items 6 + 7): the "Origin gesture" toolbar
   *  affordances, shown only while at least one column is selected. */
  selectedColCount: number;
  onPlotSelection: () => void;
  onAddSelectionToPlot: () => void;
  /** Selection → Graph Builder handoff (MAIN_PLAN #4) — same cluster, so it
   *  is only offered (and thus never enabled) with a non-empty selection. */
  onOpenInGraphBuilder: () => void;
  onClearColSelection: () => void;
  /** GUI_INTERACTION #14: is THIS worksheet linked to the live plot (row
   *  selection highlights plotted points; "Set as X axis"/"Plot as Y" edit it
   *  directly)? Shown as an explicit badge — never a silent assumption. */
  plotLinked: boolean;
}

export default function WorksheetToolbar({
  formula,
  colName,
  setFormula,
  setColName,
  onAddColumn,
  showStats,
  onToggleStats,
  onCopy,
  maskedCount,
  onUnmaskAll,
  selectedCount,
  onExcludeSelected,
  onKeepOnlySelected,
  onClearSelection,
  vars,
  selectedColCount,
  onPlotSelection,
  onAddSelectionToPlot,
  onOpenInGraphBuilder,
  onClearColSelection,
  plotLinked,
}: WorksheetToolbarProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderBottom: "1px solid var(--border, #333)",
        flexWrap: "wrap",
      }}
    >
      <span className="qzk-field-lbl" style={{ margin: 0 }}>
        ƒx
      </span>
      <input
        className="qz-input"
        placeholder="2*A + sqrt(B)"
        value={formula}
        onChange={(e) => setFormula(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && formula.trim() && onAddColumn()}
        style={{ width: 200 }}
      />
      <input
        className="qz-input"
        placeholder="column name"
        value={colName}
        onChange={(e) => setColName(e.target.value)}
        style={{ width: 120 }}
      />
      <button className="qz-btn" disabled={!formula.trim()} onClick={onAddColumn}>
        Add column
      </button>
      <button
        className={showStats ? "qz-btn qz-active" : "qz-btn"}
        aria-pressed={showStats}
        onClick={onToggleStats}
        title="Per-column statistics"
      >
        Σ Stats
      </button>
      <button className="qz-btn" onClick={onCopy} title="Copy visible rows to clipboard (TSV)">
        ⧉ Copy
      </button>
      {maskedCount > 0 && (
        <button className="qz-btn" onClick={onUnmaskAll} title="Clear all masked rows">
          Unmask ({maskedCount})
        </button>
      )}
      {selectedCount > 0 && (
        <>
          <span className="qzk-ds-meta" style={{ color: "var(--accent)" }}>
            {selectedCount} selected
          </span>
          <button
            className="qz-btn"
            onClick={onExcludeSelected}
            title="Mask the selected rows (exclude from analysis)"
          >
            Exclude
          </button>
          <button
            className="qz-btn"
            onClick={onKeepOnlySelected}
            title="Mask every row except the selected ones"
          >
            Keep only
          </button>
          <button className="qz-btn" onClick={onClearSelection} title="Clear the selection">
            Deselect
          </button>
        </>
      )}
      {selectedColCount > 0 && (
        <>
          <span className="qzk-ds-meta" style={{ color: "var(--accent)" }}>
            {selectedColCount} column{selectedColCount === 1 ? "" : "s"} selected
          </span>
          <button
            className="qz-btn"
            onClick={onPlotSelection}
            title="Plot the selected columns (designation-aware — replaces the current Y set)"
          >
            Plot selection
          </button>
          <button
            className="qz-btn"
            onClick={onAddSelectionToPlot}
            title="Add the selected columns to the current plot"
          >
            Add to plot
          </button>
          <button
            className="qz-btn"
            onClick={onOpenInGraphBuilder}
            title="Open the selected columns in the Graph Builder (prefills the X/Y wells)"
          >
            Graph Builder
          </button>
          <button className="qz-btn" onClick={onClearColSelection} title="Clear the column selection">
            Deselect columns
          </button>
        </>
      )}
      {plotLinked && (
        <span
          className="qzk-ds-meta"
          style={{ color: "var(--accent)" }}
          title="This worksheet's dataset is the live plot's — row selection highlights plotted points, and Set as X axis/Plot as Y edit it directly"
        >
          ⧟ Linked to plot
        </span>
      )}
      <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
        vars: {vars}
      </span>
    </div>
  );
}
