// Tabulate workshop — view (v2, JMP_GAP_PLAN J6). A draggable ToolWindow: drop
// up to 3 categorical columns into the Group by well (nested, outermost
// first) and one or more columns into the Value well, pick the stat set, and
// see a live nested summary table — export it as a new dataset, copy it as
// TSV (group LABELS, never ordinal codes), or emit it as a #36 report. Thin —
// the group-by math lives in lib/tabulate, the state in useTabulate, the
// table/stat-picker rendering in TabulateTable/TabulateStatPicker.

import { copyText } from "../../../lib/clipboard";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import ZoneWell from "../graphbuilder/ZoneWell";
import ToolWindow from "../../overlays/ToolWindow";
import { Switch } from "../../primitives/Switch";
import { Button } from "../../primitives";
import TabulateStatPicker from "./TabulateStatPicker";
import TabulateTable from "./TabulateTable";
import { MAX_GROUP_COLS, useTabulate } from "./useTabulate";

const rejectForeignDrop = () => toast("dropped a chip from a different dataset", "info");

export default function TabulatePanel() {
  const setOpen = useApp((s) => s.setTabulateOpen);
  const setStatus = useApp((s) => s.setStatus);
  const t = useTabulate();

  async function copy(): Promise<void> {
    const ok = await copyText(t.toTSV());
    setStatus(ok ? `copied ${t.rows.length} rows to clipboard` : "clipboard unavailable");
  }

  return (
    <ToolWindow id="tabulate" title="Tabulate" width={620} onClose={() => setOpen(false)}>
      {!t.hasData ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          Select a dataset to summarize.
        </div>
      ) : (
        <>
          <div className="qzk-zone-wells">
            <ZoneWell
              title="Group by"
              hint={`nested, up to ${MAX_GROUP_COLS}`}
              datasetId={t.datasetId}
              options={t.groupCols.length >= MAX_GROUP_COLS ? [] : t.columns}
              assigned={t.groupCols.map((c, i) => ({ channel: c, label: t.groupLabels[i] }))}
              multiple
              onAssign={t.addGroupCol}
              onRemove={t.removeGroupCol}
              onMove={t.moveGroupCol}
              onReject={rejectForeignDrop}
            />
            <ZoneWell
              title="Value"
              hint="columns to summarize"
              datasetId={t.datasetId}
              options={t.columns}
              assigned={t.valueCols.map((c, i) => ({ channel: c, label: t.valueLabels[i] }))}
              multiple
              onAssign={t.addValueCol}
              onRemove={t.removeValueCol}
              onMove={t.moveValueCol}
              onReject={rejectForeignDrop}
            />
          </div>

          <TabulateStatPicker selected={t.statKeys} onToggle={t.toggleStat} />

          <div style={{ marginTop: 8 }}>
            <Switch checked={t.grandTotal} onChange={t.setGrandTotal} label="Grand total row" />
          </div>

          {!t.groupIsCategorical && t.rows.length > 30 && (
            <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--warn, var(--text-faint))" }}>
              {t.rows.length} rows — one of the group columns looks continuous. Pick
              categorical columns to group by.
            </div>
          )}

          <TabulateTable
            groupLabels={t.groupLabels}
            valueLabels={t.valueLabels}
            statKeys={t.statKeys}
            rows={t.rows}
            levelLabel={t.levelLabel}
          />

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
