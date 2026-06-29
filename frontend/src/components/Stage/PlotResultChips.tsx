// Persistent result chips for the on-plot analysis tools (∫ Integrate · ∩ FWHM).
// Each tool commits its result to the store; this renders a glass chip per result
// stacked bottom-center (newest on top), each with a clear (×) button. The chips
// stay until cleared or the dataset changes (the store resets them per dataset).
// Pure presentational — the live values + clear actions are owned by PlotStage.

import { fmtNum } from "../../lib/format";
import type { FwhmResult } from "../../lib/peakwidth";
import type { IntegralResult } from "../../store/useApp";

interface Props {
  integral: IntegralResult | null;
  fwhm: FwhmResult | null;
  onClearIntegral: () => void;
  onClearFwhm: () => void;
}

export default function PlotResultChips({ integral, fwhm, onClearIntegral, onClearFwhm }: Props) {
  if (!integral && !fwhm) return null;
  return (
    <div className="qzk-result-chips">
      {integral && (
        <div className="qzk-glass qzk-result-chip">
          <span className="g">∫</span>
          <span className="v">{fmtNum(integral.area)}</span>
          <span className="lbl">
            {fmtNum(integral.xlo)}–{fmtNum(integral.xhi)}
          </span>
          <button className="qzk-chip-reset" title="Clear" onClick={onClearIntegral}>
            ×
          </button>
        </div>
      )}
      {fwhm && (
        <div className="qzk-glass qzk-result-chip">
          <span className="g">∩</span>
          <span className="lbl">peak</span>
          <span className="v">{fmtNum(fwhm.center)}</span>
          <span className="lbl">FWHM</span>
          <span className="v">{fmtNum(fwhm.fwhm)}</span>
          <button className="qzk-chip-reset" title="Clear" onClick={onClearFwhm}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
