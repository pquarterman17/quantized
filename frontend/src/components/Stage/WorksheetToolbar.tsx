// Presentational toolbar for the Worksheet: the computed-column formula bar plus
// the Stats / Copy / Unmask actions. All state lives in the parent (Worksheet);
// this is a thin props-driven view so the worksheet stays under the size budget.

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
  vars: string;
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
  vars,
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
      <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
        vars: {vars}
      </span>
    </div>
  );
}
