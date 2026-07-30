// Presentational toolbar for the Worksheet: the computed-column formula bar plus
// the Stats / Copy / Unmask actions, the row-selection (#50) bulk-action cluster,
// and (WORKSHEET_PLAN items 6+7) the column-selection "Plot selection"/"Add to
// plot" cluster. All state lives in the parent (Worksheet); this is a thin
// props-driven view so the worksheet stays under the size budget.

import type { BlockOpsApi } from "./useWorksheetBlockOps";

// JMP_GAP J11 formula language v2 quick reference — the hover tooltip on the
// ƒx bar. Full grammar/NaN-propagation rules live in lib/formula.ts's module
// header (the authoritative doc, since it can't drift from the parser);
// this is the compact user-facing cheat sheet.
const FORMULA_HELP = [
  "Operators: + - * / % ^   Comparisons: < <= > >= == !=   Logic: and or not",
  "Functions: sin cos tan exp log ln log10 sqrt abs pow min max",
  "if(cond, a, b) — NaN cond -> NaN",
  "Aggregates (scalar, same value every row): mean(A) sd(A) min(A) max(A) median(A) sum(A) count(A)",
  "Row: row() is 1-based · lag(A, k) — NaN past the edge · diff(A) = A - lag(A, 1)",
  "Variables: x and the channel letters A, B, C, …",
].join("\n");

export interface WorksheetToolbarProps {
  formula: string;
  colName: string;
  setFormula: (v: string) => void;
  setColName: (v: string) => void;
  onAddColumn: () => void;
  showStats: boolean;
  onToggleStats: () => void;
  onCopy: () => void;
  /** MAIN #34 block ops — shown only when a row×column block is selected. */
  blockOps: BlockOpsApi;
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
  blockOps,
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
        title={FORMULA_HELP}
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
      {blockOps.hasBlock && (
        <>
          {/* MAIN #34: rectangular operations, shown only with a real block
              selected so the toolbar stays quiet the rest of the time. */}
          <button className="qz-btn" onClick={blockOps.copyBlock} title="Copy the selected block (no header, pastes back cleanly)">
            ⧉ Block
          </button>
          <button className="qz-btn" onClick={blockOps.cutBlock} title="Copy the selected block, then blank it (⌘X)">
            Cut
          </button>
          <button className="qz-btn" onClick={blockOps.pasteBlock} title="Paste clipboard cells at the top-left of the selection (⌘V)">
            Paste
          </button>
          <button className="qz-btn" onClick={blockOps.fillDown} title="Copy the top selected row down the rest of the selection">
            Fill ↓
          </button>
          <button className="qz-btn" onClick={blockOps.clearBlock} title="Blank every selected cell (undoable)">
            Clear
          </button>
        </>
      )}
      {blockOps.hasRows && (
        <>
          {/* Row operations need ROWS, not a rectangular block — they are
              offered whenever rows are selected, even with no column picked. */}
          <button className="qz-btn" onClick={blockOps.insertRows} title="Insert blank rows above the selection">
            +Rows
          </button>
          <button className="qz-btn" onClick={blockOps.deleteRows} title="Delete the selected rows (undoable; exclusions are remapped)">
            −Rows
          </button>
        </>
      )}
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
