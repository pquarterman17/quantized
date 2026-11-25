// Time series workshop (GAP_AUDIT_9 G13), view: ACF/PACF, stationarity (ADF,
// KPSS), classical decomposition, change points and ARIMA for one channel of
// the active worksheet (long-log drift: chamber pressure, temperature,
// cryostat stability). A result shows as the result book (Save result, table
// actions); "Add as worksheet" still commits it as a linked worksheet (state: ./useTimeSeries).

import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import AnalysisInputSummary from "../analysisselection/AnalysisInputSummary";
import TsForms from "./TsForms";
import TsResultBook from "./TsResultBook";
import { TS_TABS, type TsTab } from "./timeSeriesRun";
import { useTimeSeries } from "./useTimeSeries";

export default function TimeSeriesPanel() {
  const hide = useAnalysisExtras((s) => s.hide);
  const t = useTimeSeries();
  return (
    <ToolWindow id="time-series" title="Time series" width={460} onClose={() => hide("time-series")}>
      {!t.hasData ? (
        <div className="qzk-helptext" style={{ color: "var(--text-faint)" }}>Select a dataset to analyze.</div>
      ) : (
        <>
          <AnalysisInputSummary inputs={t.inputs} />
          <div style={{ marginTop: 8 }}>
            <label className="qzk-field-lbl">Series (channel against the X column)</label>
            <Select aria-label="Series" options={t.columns.map((c) => ({ value: String(c.index), label: c.label }))}
              value={String(t.col)} onChange={(e) => t.setCol(Number(e.target.value))} />
          </div>
          <div style={{ marginTop: 8 }}>
            <SegmentedControl<TsTab> aria-label="Time-series tool" options={TS_TABS.map((x) => ({ value: x.id, label: x.label }))} value={t.tab} onChange={t.setTab} />
          </div>
          <TsForms t={t} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
            <Button size="sm" disabled={!!t.problem || t.busy} title={t.problem ?? undefined} onClick={() => void t.run()}>{t.busy ? "Running…" : "Run"}</Button>
            <Button size="sm" disabled={!t.canCommit} title="Add the result as a linked worksheet (one undo step; a repeat adds nothing)" onClick={t.commit}>Add as worksheet</Button>
          </div>
          {t.problem && <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>{t.problem}</div>}
          {t.error && <div className="qzk-ds-meta" role="alert" style={{ marginTop: 6, color: "var(--warn, var(--text-faint))" }}>{t.error}</div>}
          {t.done && <div className="qzk-ds-meta" style={{ marginTop: 6 }}>{t.done}</div>}
          {t.stale && !t.busy && <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>The series or settings changed since the last run; run again.</div>}
          <TsResultBook t={t} />
        </>
      )}
    </ToolWindow>
  );
}
