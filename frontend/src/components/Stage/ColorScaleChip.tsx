// The colour-scale chip (MAIN #14): a gradient strip with the scale's min and
// max — one row per distinct colour scale. Moved out of PlotLegend.tsx so the
// Graph Builder preview's gradient Color-by (P1.4 residual 4) shows the SAME
// key the Stage legend does.

import type { ColorScaleLegendEntry } from "../../lib/colorscatter";
import { colormapCss } from "../../lib/colormap";
import { fmtNum } from "../../lib/format";

export default function ColorScaleChip({ scale }: { scale: ColorScaleLegendEntry }) {
  // GUI audit: a bare gradient strip has no accessible name; `img` + label
  // announces the channel and range (the three number spans stay visual).
  return (
    <div
      className="it qzk-colorbar"
      role="img"
      aria-label={`Colour scale ${scale.label}: ${fmtNum(scale.lo)} to ${fmtNum(scale.hi)}`}
      title={`colour = ${scale.label}`}
    >
      <span
        className="qzk-colorbar-grad"
        style={{
          background: `linear-gradient(90deg, ${Array.from({ length: 9 }, (_, s) => colormapCss(scale.colormap, s / 8)).join(", ")})`,
        }}
      />
      <span className="qzk-colorbar-lbl">{fmtNum(scale.lo)}</span>
      <span className="qzk-colorbar-lbl">–</span>
      <span className="qzk-colorbar-lbl">{fmtNum(scale.hi)}</span>
    </div>
  );
}
