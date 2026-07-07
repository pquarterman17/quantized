// Test chooser (#26) — view. A draggable ToolWindow: pick groups (columns, or
// value-by-category), get a recommended test with its assumption checks shown
// as plain-language reasons, run it one-click, and land the result as a #36
// report. Thin — all state/logic lives in useStatsChooser.

import { fmtNum } from "../../../lib/format";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { Button, Checkbox, DataTable, SegmentedControl, Select, StatusDot } from "../../primitives";
import { resultRows } from "../../../lib/statschooser";
import { useStatsChooser } from "./useStatsChooser";

export default function StatsChooserPanel() {
  const setOpen = useApp((s) => s.setStatsChooserOpen);
  const c = useStatsChooser();
  const colOptions = c.columns.map((col) => ({ value: String(col.index), label: col.label }));
  const faint = { color: "var(--text-faint)" } as const;

  return (
    <ToolWindow title="Test chooser" width={400} onClose={() => setOpen(false)}>
      {!c.active ? (
        <div className="qzk-ds-meta" style={faint}>
          Select a dataset to analyze.
        </div>
      ) : (
        <>
          <SegmentedControl
            options={[
              { value: "columns", label: "Columns as groups" },
              { value: "groupby", label: "Value by category" },
            ]}
            value={c.mode}
            onChange={c.setMode}
          />

          {c.mode === "columns" ? (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
              {c.columns.map((col) => (
                <Checkbox
                  key={col.index}
                  checked={c.cols.includes(col.index)}
                  onChange={() => c.toggleCol(col.index)}
                >
                  {col.label}
                </Checkbox>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              <label className="qzk-field-lbl">Value</label>
              <Select
                options={colOptions}
                value={String(c.valueCol)}
                onChange={(e) => c.setValueCol(Number(e.target.value))}
              />
              <label className="qzk-field-lbl" style={{ marginTop: 6 }}>
                Group by
              </label>
              <Select
                options={colOptions}
                value={String(c.byCol)}
                onChange={(e) => c.setByCol(Number(e.target.value))}
              />
              {!c.byIsCategorical && (
                <div className="qzk-ds-meta" style={{ ...faint, marginTop: 4 }}>
                  ⚠ group column looks continuous — every distinct value becomes a group
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
            <span className="qzk-ds-meta" style={faint}>
              {c.groups.length} group{c.groups.length === 1 ? "" : "s"} ·{" "}
              {c.groups.map((g) => g.values.length).join(" / ") || "—"} pts
            </span>
            <span style={{ flex: 1 }} />
            <Checkbox
              checked={c.paired && c.pairable}
              disabled={!c.pairable}
              onChange={(checked) => c.setPaired(checked)}
            >
              paired
            </Checkbox>
          </div>

          <div style={{ marginTop: 8 }}>
            <Button
              variant="primary"
              size="sm"
              disabled={c.busy || c.groups.length === 0}
              onClick={() => void c.recommend()}
            >
              {c.busy ? "Checking…" : "Which test?"}
            </Button>
          </div>

          {c.error && (
            <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--danger)" }}>
              {c.error}
            </div>
          )}

          {c.rec && (
            <div style={{ marginTop: 10 }}>
              <StatusDot
                tone={c.rec.parametric ? "ok" : "warn"}
                label={
                  <span>
                    <strong>{c.rec.recommendation}</strong> ·{" "}
                    {c.rec.parametric ? "parametric" : "nonparametric"}
                  </span>
                }
              />
              <ul className="qzk-reason-list">
                {c.rec.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              <Button size="sm" disabled={c.busy} onClick={() => void c.runRecommended()}>
                Run {c.rec.recommendation}
              </Button>
            </div>
          )}

          {c.testResult && (
            <div style={{ marginTop: 10 }}>
              <DataTable
                columns={["stat", "value"]}
                rows={resultRows(c.testResult).map(([k, v]) => [
                  k,
                  typeof v === "number" ? fmtNum(v) : v,
                ])}
              />
              <div style={{ marginTop: 8 }}>
                <Button size="sm" disabled={c.busy} onClick={() => void c.toReport()}>
                  → Report
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </ToolWindow>
  );
}
