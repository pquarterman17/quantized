// Peaks workshop — view. A draggable ToolWindow listing detected peaks
// (center / height / FWHM / SNR) with markers on the plot via the store overlay
// (see usePeaks), plus fit controls: fit all peaks simultaneously (shared
// background) or each independently, then show the fitted parameters + R².
// "→ Report" lands the fitted peak table as a #36 report sheet in the library.

import { useState } from "react";

import PeakFitControls from "./PeakFitControls";
import { usePeaks } from "./usePeaks";
import ToolWindow from "../../overlays/ToolWindow";
import { Button, DataTable } from "../../primitives";
import { reportEmit } from "../../../lib/api";
import { fmtNum } from "../../../lib/format";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";

export default function PeaksPanel() {
  const setOpen = useApp((s) => s.setPeaksOpen);
  const setPeakOverlay = useApp((s) => s.setPeakOverlay);
  const addReport = useApp((s) => s.addReport);
  const [reporting, setReporting] = useState(false);
  const { active, peaks, busy, error, fitResult, fitting, fitError, fitTogether, fitEach } =
    usePeaks();

  const close = () => {
    setPeakOverlay(null); // remove the markers when the panel closes
    setOpen(false);
  };

  const toReport = async () => {
    if (!fitResult || !active) return;
    setReporting(true);
    try {
      const { report } = await reportEmit({
        kind: "multipeak_fit",
        result: fitResult as unknown as Record<string, unknown>,
        title: `Peak fit — ${active.name}`,
        source_refs: [{ kind: "dataset", id: active.id, name: active.name }],
      });
      addReport(`Peak fit — ${active.name}`, report, active.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "report failed", "danger");
    } finally {
      setReporting(false);
    }
  };

  const rows = peaks.map((p, i) => [
    i + 1,
    fmtNum(p.center),
    fmtNum(p.height),
    fmtNum(p.fwhm),
    fmtNum(p.localSNR),
  ]);

  const fitRows = (fitResult?.peaks ?? []).map((p, i) => [
    i + 1,
    fmtNum(p.center),
    fmtNum(p.height),
    fmtNum(p.fwhm),
    fmtNum(p.area),
  ]);

  const faint = { color: "var(--text-faint)" } as const;

  return (
    <ToolWindow id="peaks" title="Peaks" width={360} onClose={close}>
      {!active && (
        <div className="qzk-ds-meta" style={faint}>
          Select a dataset to find peaks.
        </div>
      )}
      {active && busy && <div className="qzk-ds-meta">Finding peaks…</div>}
      {active && error && (
        <div className="qzk-ds-meta" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      )}
      {active && !busy && !error && peaks.length === 0 && (
        <div className="qzk-ds-meta" style={faint}>
          No peaks found.
        </div>
      )}
      {rows.length > 0 && (
        <DataTable columns={["#", "center", "height", "FWHM", "SNR"]} rows={rows} />
      )}

      {active && (
        <PeakFitControls
          disabled={peaks.length === 0}
          fitting={fitting}
          onFitTogether={fitTogether}
          onFitEach={fitEach}
        />
      )}

      {fitError && (
        <div className="qzk-ds-meta" style={{ color: "var(--danger)", marginTop: 6 }}>
          {fitError}
        </div>
      )}

      {fitResult && fitResult.peaks.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="qzk-ds-meta" style={{ ...faint, marginBottom: 4 }}>
            {fitResult.model} ·{" "}
            {fitResult.R2 == null ? "independent fits" : `R² = ${fmtNum(fitResult.R2)}`}
            {fitResult.rmse != null && ` · RMSE = ${fmtNum(fitResult.rmse)}`}
          </div>
          <DataTable
            columns={["#", "center", "height", "FWHM", "area"]}
            rows={fitRows}
          />
          <div style={{ marginTop: 8 }}>
            <Button size="sm" disabled={reporting} onClick={() => void toReport()}>
              {reporting ? "Reporting…" : "→ Report"}
            </Button>
          </div>
        </div>
      )}
    </ToolWindow>
  );
}
