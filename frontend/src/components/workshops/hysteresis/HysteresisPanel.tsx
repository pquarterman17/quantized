// Hysteresis workshop — view. A draggable ToolWindow that shows the extracted
// loop parameters (Hc / Mr / Ms / squareness / loop area / SFD) for the active
// M-H dataset. Thin by design — all logic lives in useHysteresis.

import ToolWindow from "../../overlays/ToolWindow";
import { DataTable } from "../../primitives/DataTable";
import { Button } from "../../primitives";
import { fmtNum } from "../../../lib/format";
import { useApp } from "../../../store/useApp";
import { useHysteresis } from "./useHysteresis";

export default function HysteresisPanel() {
  const setOpen = useApp((s) => s.setHysteresisOpen);
  const { active, result, units, busy, warning, error, bgBusy, subtractBackground } =
    useHysteresis();
  const { h, m } = units;
  const area = h && m ? `${h}·${m}` : "";

  const sfd = (result?.SFD as Record<string, unknown> | undefined) ?? {};
  const warnings = (result?.warnings as string[] | undefined) ?? [];
  const rows: (string | number)[][] = result
    ? [
        ["Hc (mean)", fmtNum(result.HcMean), h],
        ["Mr (mean)", fmtNum(result.MrMean), m],
        ["Ms (mean)", fmtNum(result.MsMean), m],
        ["Squareness", fmtNum(result.squareness), ""],
        ["Loop area", fmtNum(result.loopArea), area],
        ["SFD peak H", fmtNum(sfd.peakH), h],
        ["SFD FWHM", fmtNum(sfd.fwhm), h],
      ]
    : [];

  return (
    <ToolWindow id="hysteresis" title="Hysteresis" width={320} onClose={() => setOpen(false)}>
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
      {active && warning && (
        <div className="qzk-ds-meta" style={{ color: "var(--warn, #c90)" }}>
          {warning}
        </div>
      )}
      {rows.length > 0 && (
        <>
          <DataTable columns={["parameter", "value", "unit"]} rows={rows} />
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
      {active && (
        <div style={{ marginTop: 10 }}>
          <Button
            size="sm"
            disabled={bgBusy}
            onClick={() => void subtractBackground()}
            title="Subtract the high-field linear background and centre the loop into a new (bg-sub) dataset."
          >
            {bgBusy ? "Subtracting…" : "Subtract linear background"}
          </Button>
        </div>
      )}
    </ToolWindow>
  );
}
