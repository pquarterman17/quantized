// Spectroscopy extras workshop (GAP_AUDIT_9 G21), view: Fourier self-deconvolution
// (peak resolution enhancement), 2-D correlation spectroscopy (Noda) and peak
// onset for the ticked columns of the active worksheet. Results can be added as
// worksheets (state: ./useSpectroExtras).

import ToolWindow from "../../overlays/ToolWindow";
import { Button } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import AnalysisInputSummary from "../analysisselection/AnalysisInputSummary";
import SeForms from "./SeForms";
import SeResults from "./SeResults";
import { SE_TABS, type SeTab } from "./spectroRun";
import { useSpectroExtras } from "./useSpectroExtras";

export default function SpectroExtrasPanel() {
  const hide = useAnalysisExtras((s) => s.hide);
  const t = useSpectroExtras();
  return (
    <ToolWindow id="spectro-extras" title="Spectroscopy extras" width={480} onClose={() => hide("spectro-extras")}>
      {!t.hasData ? (
        <div className="qzk-helptext" style={{ color: "var(--text-faint)" }}>Select a dataset to analyse.</div>
      ) : (
        <>
          <AnalysisInputSummary inputs={t.inputs} />
          <div style={{ marginTop: 8 }}>
            <label className="qzk-field-lbl">Spectra (tick the columns, against the X column)</label>
            <div role="group" aria-label="Spectra" style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", maxHeight: 96, overflowY: "auto" }}>
              {t.columns.map((c) => (
                <Checkbox key={c.index} checked={t.picked.includes(c.index)} onChange={() => t.toggle(c.index)}>{c.label}</Checkbox>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <SegmentedControl<SeTab> aria-label="Spectroscopy tool" options={SE_TABS.map((x) => ({ value: x.id, label: x.label }))} value={t.tab} onChange={t.setTab} />
          </div>
          <SeForms t={t} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
            <Button size="sm" disabled={!!t.problem || t.busy} title={t.problem ?? undefined} onClick={() => void t.run()}>{t.busy ? "Running…" : "Run"}</Button>
            <Button size="sm" disabled={!t.canCommit} title="Add the result as linked worksheet(s) (one undo step each; a repeat adds nothing)" onClick={t.commit}>Add as worksheet</Button>
          </div>
          {t.problem && <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>{t.problem}</div>}
          {t.error && <div className="qzk-ds-meta" role="alert" style={{ marginTop: 6, color: "var(--warn, var(--text-faint))" }}>{t.error}</div>}
          {t.done && <div className="qzk-ds-meta" style={{ marginTop: 6 }}>{t.done}</div>}
          {t.stale && !t.busy && <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>The spectra or settings changed since the last run; run again.</div>}
          {t.result && <SeResults result={t.result} figures={t.figures} />}
        </>
      )}
    </ToolWindow>
  );
}
