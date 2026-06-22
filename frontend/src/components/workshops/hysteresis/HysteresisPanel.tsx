// Hysteresis workshop — view. A draggable ToolWindow that shows the extracted
// loop parameters (Hc / Mr / Ms / squareness / loop area / SFD) for the active
// M-H dataset. Thin by design — all logic lives in useHysteresis.

import ToolWindow from "../../overlays/ToolWindow";
import { DataTable } from "../../primitives";
import { fmtNum } from "../../../lib/format";
import { useApp } from "../../../store/useApp";
import { useHysteresis } from "./useHysteresis";

export default function HysteresisPanel() {
  const setOpen = useApp((s) => s.setHysteresisOpen);
  const { active, result, busy, error } = useHysteresis();

  const sfd = (result?.SFD as Record<string, unknown> | undefined) ?? {};
  const warnings = (result?.warnings as string[] | undefined) ?? [];
  const rows: (string | number)[][] = result
    ? [
        ["Hc (mean)", fmtNum(result.HcMean)],
        ["Mr (mean)", fmtNum(result.MrMean)],
        ["Ms (mean)", fmtNum(result.MsMean)],
        ["Squareness", fmtNum(result.squareness)],
        ["Loop area", fmtNum(result.loopArea)],
        ["SFD peak H", fmtNum(sfd.peakH)],
        ["SFD FWHM", fmtNum(sfd.fwhm)],
      ]
    : [];

  return (
    <ToolWindow title="Hysteresis" width={320} onClose={() => setOpen(false)}>
      {!active && (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          Select an M-H dataset.
        </div>
      )}
      {active && busy && <div className="qzk-ds-meta">Analyzing…</div>}
      {active && error && (
        <div className="qzk-ds-meta" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      )}
      {rows.length > 0 && (
        <>
          <DataTable columns={["parameter", "value"]} rows={rows} />
          {warnings.length > 0 && (
            <div
              className="qzk-ds-meta"
              style={{ marginTop: 8, color: "var(--text-faint)" }}
            >
              {warnings[0]}
            </div>
          )}
        </>
      )}
    </ToolWindow>
  );
}
