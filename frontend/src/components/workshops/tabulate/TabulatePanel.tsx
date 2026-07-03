// Tabulate workshop — view. A draggable ToolWindow: pick a "group by" column and
// a value column; see per-group descriptive stats (count/mean/sd/min/max/median)
// and export the summary as a new dataset or copy it as TSV. Thin — the group-by
// math lives in lib/tabulate and the state in useTabulate.

import { copyText } from "../../../lib/clipboard";
import { fmtNum } from "../../../lib/format";
import { AGG_KEYS } from "../../../lib/tabulate";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import { useTabulate } from "./useTabulate";

export default function TabulatePanel() {
  const setOpen = useApp((s) => s.setTabulateOpen);
  const setStatus = useApp((s) => s.setStatus);
  const t = useTabulate();
  const colOptions = t.columns.map((c) => ({ value: String(c.index), label: c.label }));

  async function copy(): Promise<void> {
    const ok = await copyText(t.toTSV());
    setStatus(ok ? `copied ${t.rows.length} groups to clipboard` : "clipboard unavailable");
  }

  return (
    <ToolWindow title="Tabulate" width={440} onClose={() => setOpen(false)}>
      {!t.hasData ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          Select a dataset to summarize.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label className="qzk-field-lbl">Group by</label>
              <Select
                options={colOptions}
                value={String(t.groupCol)}
                onChange={(e) => t.setGroupCol(Number(e.target.value))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="qzk-field-lbl">Value</label>
              <Select
                options={colOptions}
                value={String(t.valueCol)}
                onChange={(e) => t.setValueCol(Number(e.target.value))}
              />
            </div>
          </div>

          {!t.groupIsCategorical && t.rows.length > 30 && (
            <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--warn, var(--text-faint))" }}>
              {t.rows.length} groups — “{t.groupLabel}” looks continuous. Pick a
              categorical column to group by.
            </div>
          )}

          {t.rows.length === 0 ? (
            <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--text-faint)" }}>
              No finite rows to summarize.
            </div>
          ) : (
            <table
              className="qzk-tabulate-table"
              style={{ width: "100%", marginTop: 12, fontSize: 11 }}
            >
              <thead style={{ color: "var(--text-faint)", textAlign: "right" }}>
                <tr>
                  <th style={{ textAlign: "left" }}>{t.groupLabel}</th>
                  {AGG_KEYS.map((k) => (
                    <th key={k}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
                {t.rows.map((r) => (
                  <tr key={r.group} style={{ textAlign: "right" }}>
                    <td style={{ textAlign: "left", color: "var(--text)" }}>{fmtNum(r.group)}</td>
                    <td>{r.count}</td>
                    <td>{fmtNum(r.mean)}</td>
                    <td>{fmtNum(r.sd)}</td>
                    <td>{fmtNum(r.min)}</td>
                    <td>{fmtNum(r.max)}</td>
                    <td>{fmtNum(r.median)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Button
              variant="primary"
              size="sm"
              disabled={!t.rows.length}
              onClick={t.exportDataset}
              style={{ flex: 1 }}
            >
              Export → dataset
            </Button>
            <Button size="sm" disabled={!t.rows.length} onClick={() => void copy()} style={{ flex: 1 }}>
              Copy TSV
            </Button>
          </div>
        </>
      )}
    </ToolWindow>
  );
}
