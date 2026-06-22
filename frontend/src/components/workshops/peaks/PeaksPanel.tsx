// Peaks workshop — view. A draggable ToolWindow listing detected peaks
// (center / height / FWHM / SNR); markers are drawn on the plot via the store
// overlay (see usePeaks). Closing clears the overlay. Thin by design.

import ToolWindow from "../../overlays/ToolWindow";
import { DataTable } from "../../primitives";
import { fmtNum } from "../../../lib/format";
import { useApp } from "../../../store/useApp";
import { usePeaks } from "./usePeaks";

export default function PeaksPanel() {
  const setOpen = useApp((s) => s.setPeaksOpen);
  const setPeakOverlay = useApp((s) => s.setPeakOverlay);
  const { active, peaks, busy, error } = usePeaks();

  const close = () => {
    setPeakOverlay(null); // remove the markers when the panel closes
    setOpen(false);
  };

  const rows = peaks.map((p, i) => [
    i + 1,
    fmtNum(p.center),
    fmtNum(p.height),
    fmtNum(p.fwhm),
    fmtNum(p.localSNR),
  ]);

  return (
    <ToolWindow title="Peaks" width={360} onClose={close}>
      {!active && (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
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
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          No peaks found.
        </div>
      )}
      {rows.length > 0 && (
        <DataTable columns={["#", "center", "height", "FWHM", "SNR"]} rows={rows} />
      )}
    </ToolWindow>
  );
}
