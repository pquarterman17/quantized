// Curve Fit — the four residual plots themselves (lazy chunk: uPlot loads
// only once "Residual plots" is opened). Drawn by the shared SmallUPlot.

import type { RefLine } from "../../../lib/types";
import SmallUPlot from "../SmallUPlot";
import type { ResidualPlots } from "./residualPlotData";

const ZERO: RefLine[] = [{ id: "zero", axis: "y", value: 0 }];
/** Each plot's height (px): with SmallUPlot's compact axis bands this leaves
 *  ~110 px of data area and room for the longest Y title ("ordered residual"). */
const PLOT_HEIGHT = 170;

export default function ResidualPlotGrid({ plots, qqNote, qqFailed }: { plots: ResidualPlots; qqNote: string; qqFailed: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
      <SmallUPlot payload={plots.vsX} label="residual vs X" height={PLOT_HEIGHT} refLines={ZERO} compact />
      <SmallUPlot payload={plots.vsFitted} label="residual vs fitted value" height={PLOT_HEIGHT} refLines={ZERO} compact />
      <SmallUPlot payload={plots.histogram} label="residual histogram" height={PLOT_HEIGHT} compact />
      {plots.qq ? (
        <SmallUPlot payload={plots.qq} label="normal Q-Q plot of residuals" height={PLOT_HEIGHT} compact />
      ) : (
        <div className="qzk-ds-meta" style={{ color: qqFailed ? "var(--danger)" : "var(--text-faint)" }}>
          {qqNote}
        </div>
      )}
    </div>
  );
}
