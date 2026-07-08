// Persistent result chips for the on-plot analysis tools (∫ Integrate · ∩ FWHM
// · ≈ Quick-fit #33). Each tool commits its result to the store; this renders a
// glass chip per result stacked bottom-center (newest on top), each with a
// clear (×) button. The ∫/∩ chips stay until cleared or the dataset changes
// (the store resets them per dataset); the quick-fit chip additionally clears
// on Escape / tool-switch (see useQuickFitChip). Pure presentational — the
// live values + actions are owned by PlotStage (via useQuickFitChip for qfit).

import { fmtNum } from "../../lib/format";
import type { FwhmResult } from "../../lib/peakwidth";
import { formatQfitParams } from "../../lib/quickfit";
import type { IntegralResult } from "../../store/useApp";
import { Button, Select } from "../primitives";
import type { QuickFitChipState } from "./useQuickFitChip";

interface Props {
  integral: IntegralResult | null;
  fwhm: FwhmResult | null;
  onClearIntegral: () => void;
  onClearFwhm: () => void;
  /** Quick-fit gadget chip state (optional so other PlotResultChips callers/
   *  tests that don't exercise #33 stay unchanged). */
  qfit?: QuickFitChipState;
}

export default function PlotResultChips({ integral, fwhm, onClearIntegral, onClearFwhm, qfit }: Props) {
  const showQfit = !!qfit && (qfit.roi != null || qfit.result != null || qfit.busy || qfit.error != null);
  if (!integral && !fwhm && !showQfit) return null;
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
      {showQfit && qfit && (
        <div className="qzk-glass qzk-result-chip qzk-qfit-chip">
          <span className="g">≈</span>
          <Select
            options={qfit.models.map((m) => ({ value: m, label: m }))}
            value={qfit.model}
            onChange={(e) => qfit.setModel(e.target.value)}
          />
          {qfit.busy && <span className="lbl">fitting…</span>}
          {!qfit.busy && qfit.error && (
            <span className="lbl" style={{ color: "var(--danger)" }}>
              {qfit.error}
            </span>
          )}
          {!qfit.busy && !qfit.error && qfit.result && (
            <>
              <span className="v">{formatQfitParams(qfit.result)}</span>
              <span className="lbl">R²</span>
              <span className="v">{fmtNum(qfit.result.R2)}</span>
            </>
          )}
          <Button size="sm" disabled={!qfit.result || qfit.busy} onClick={qfit.commit}>
            Commit
          </Button>
          <Button
            size="sm"
            disabled={!qfit.result || qfit.busy || qfit.reporting}
            onClick={() => void qfit.report()}
          >
            {qfit.reporting ? "Reporting…" : "→ Report"}
          </Button>
          <button className="qzk-chip-reset" title="Clear" onClick={qfit.dismiss}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
