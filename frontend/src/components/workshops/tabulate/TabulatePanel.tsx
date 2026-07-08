// Tabulate workshop — view. A draggable ToolWindow: drop a categorical column
// into the Group well and a value column into the Value well (or click-to-assign
// — the ZoneWell fallback, ORIGIN_GAP #55/#51); see per-group descriptive stats
// (count/mean/sd/min/max/median), export the summary as a new dataset, copy it as
// TSV, or emit it as a #36 report. Thin — the group-by math lives in lib/tabulate
// and the state in useTabulate.

import { copyText } from "../../../lib/clipboard";
import { fmtNum } from "../../../lib/format";
import { AGG_KEYS } from "../../../lib/tabulate";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import ZoneWell from "../graphbuilder/ZoneWell";
import ToolWindow from "../../overlays/ToolWindow";
import { Button } from "../../primitives";
import { useTabulate } from "./useTabulate";

const rejectForeignDrop = () => toast("dropped a chip from a different dataset", "info");

export default function TabulatePanel() {
  const setOpen = useApp((s) => s.setTabulateOpen);
  const setStatus = useApp((s) => s.setStatus);
  const t = useTabulate();

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
          <div className="qzk-zone-wells">
            <ZoneWell
              title="Group by"
              hint="categorical column"
              datasetId={t.datasetId}
              options={t.columns}
              assigned={[{ channel: t.groupCol, label: t.groupLabel }]}
              multiple
              onAssign={(c) => t.setGroupCol(c)}
              onRemove={() => t.removeGroupCol()}
              onReject={rejectForeignDrop}
            />
            <ZoneWell
              title="Value"
              hint="column to summarize"
              datasetId={t.datasetId}
              options={t.columns}
              assigned={[{ channel: t.valueCol, label: t.valueLabel }]}
              multiple
              onAssign={(c) => t.setValueCol(c)}
              onRemove={() => t.removeValueCol()}
              onReject={rejectForeignDrop}
            />
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
            <Button
              size="sm"
              disabled={!t.rows.length || t.reportBusy}
              onClick={() => void t.toReport()}
              style={{ flex: 1 }}
            >
              {t.reportBusy ? "Reporting…" : "→ Report"}
            </Button>
          </div>
        </>
      )}
    </ToolWindow>
  );
}
