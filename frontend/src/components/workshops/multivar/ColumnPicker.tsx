// Multivariate workbench (JMP_GAP J10) — column picker (item 1): a
// checkbox list of the active dataset's columns (default: every continuous
// channel, lib/modeling.ts), with "all" / "default" shortcuts. A compact
// scrolling list rather than drag wells — JMP's own Multivariate platform
// launch dialog is a plain checklist, and this platform can want many more
// than the 1-2 columns Graph Builder's wells assume.

import { Checkbox } from "../../primitives/Checkbox";
import { Button } from "../../primitives";
import type { MultivarState } from "./useMultivar";

export default function ColumnPicker({ m }: { m: MultivarState }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <label className="qzk-field-lbl" style={{ margin: 0 }}>
          Columns ({m.selected.length} selected)
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" onClick={m.selectDefault}>
            Continuous
          </Button>
          <Button size="sm" onClick={m.selectAll}>
            All
          </Button>
        </div>
      </div>
      <div
        style={{
          marginTop: 6,
          maxHeight: 130,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          border: "1px solid var(--border-soft)",
          borderRadius: 4,
          padding: 6,
        }}
      >
        {m.columns.map((c) => (
          <Checkbox key={c.index} checked={m.selected.includes(c.index)} onChange={() => m.toggleColumn(c.index)}>
            {c.label}
          </Checkbox>
        ))}
      </div>
      {m.tooFewColumns && (
        <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--warn, var(--text-faint))" }}>
          pick at least 2 columns
        </div>
      )}
    </div>
  );
}
