// Curve Fit — the four residual plots themselves (lazy chunk: uPlot loads
// only once "Residual plots" is opened). Drawn by the shared SmallUPlot.

import type { RefLine } from "../../../lib/types";
import SmallUPlot from "../SmallUPlot";
import type { ResidualPlots } from "./residualPlotData";

const ZERO: RefLine[] = [{ id: "zero", axis: "y", value: 0 }];

export default function ResidualPlotGrid({ plots, qqNote, qqFailed }: { plots: ResidualPlots; qqNote: string; qqFailed: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
      <SmallUPlot payload={plots.vsX} label="residual vs X" height={110} refLines={ZERO} />
      <SmallUPlot payload={plots.vsFitted} label="residual vs fitted value" height={110} refLines={ZERO} />
      <SmallUPlot payload={plots.histogram} label="residual histogram" height={110} />
      {plots.qq ? (
        <SmallUPlot payload={plots.qq} label="normal Q-Q plot of residuals" height={130} />
      ) : (
        <div className="qzk-ds-meta" style={{ color: qqFailed ? "var(--danger)" : "var(--text-faint)" }}>
          {qqNote}
        </div>
      )}
    </div>
  );
}
