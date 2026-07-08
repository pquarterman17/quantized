// Persistent result chips for the on-plot analysis tools (∫ Integrate · ∩ FWHM
// · ≈ the ROI gadget family #33/#34). Each tool commits its result to the
// store; this renders a glass chip per result stacked bottom-center (newest on
// top), each with a clear (×) button. The ∫/∩ chips stay until cleared or the
// dataset changes (the store resets them per dataset); the gadget chip
// additionally clears on Escape / tool-switch (see useGadgetChip). Pure
// presentational — the live values + actions are owned by PlotStage (via
// useGadgetChip for the gadget).

import { formatMeasurement } from "../../lib/measure";
import { fmtNum } from "../../lib/format";
import type { FwhmResult } from "../../lib/peakwidth";
import { formatQfitParams, GADGET_MODE_LABELS } from "../../lib/quickfit";
import type { IntegralResult } from "../../store/useApp";
import { Button, Select } from "../primitives";
import type { GadgetChipState } from "./useGadgetChip";

interface Props {
  integral: IntegralResult | null;
  fwhm: FwhmResult | null;
  onClearIntegral: () => void;
  onClearFwhm: () => void;
  /** ROI gadget family chip state (optional so other PlotResultChips callers/
   *  tests that don't exercise #33/#34 stay unchanged). */
  gadget?: GadgetChipState;
}

export default function PlotResultChips({ integral, fwhm, onClearIntegral, onClearFwhm, gadget }: Props) {
  const showGadget = !!gadget && (gadget.roi != null || gadget.cursors != null || gadget.busy || gadget.error != null);
  if (!integral && !fwhm && !showGadget) return null;
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
      {showGadget && gadget && (
        <div className="qzk-glass qzk-result-chip qzk-gadget-chip">
          <span className="g">≈</span>
          <Select
            options={gadget.modes.map((m) => ({ value: m, label: GADGET_MODE_LABELS[m] }))}
            value={gadget.mode}
            onChange={(e) => gadget.setMode(e.target.value as GadgetChipState["mode"])}
          />
          {gadget.mode === "fit" && (
            <Select
              options={gadget.models.map((m) => ({ value: m, label: m }))}
              value={gadget.model}
              onChange={(e) => gadget.setModel(e.target.value)}
            />
          )}
          {gadget.busy && <span className="lbl">computing…</span>}
          {!gadget.busy && gadget.error && (
            <span className="lbl" style={{ color: "var(--danger)" }}>
              {gadget.error}
            </span>
          )}
          {!gadget.busy && !gadget.error && gadget.mode === "fit" && gadget.fitResult && (
            <>
              <span className="v">{formatQfitParams(gadget.fitResult)}</span>
              <span className="lbl">R²</span>
              <span className="v">{fmtNum(gadget.fitResult.R2)}</span>
            </>
          )}
          {!gadget.busy && !gadget.error && gadget.mode === "integrate" && gadget.integrateResult && (
            <>
              <span className="lbl">area</span>
              <span className="v">{fmtNum(gadget.integrateResult.peaks[0]?.area)}</span>
              <span className="lbl">centroid</span>
              <span className="v">{fmtNum(gadget.integrateResult.peaks[0]?.centroid)}</span>
              <span className="lbl">FWHM</span>
              <span className="v">{fmtNum(gadget.integrateResult.peaks[0]?.fwhm)}</span>
            </>
          )}
          {!gadget.busy && !gadget.error && gadget.mode === "stats" && gadget.statsResult && (
            <>
              <span className="lbl">N</span>
              <span className="v">{String(gadget.statsResult.N ?? "—")}</span>
              <span className="lbl">mean</span>
              <span className="v">{fmtNum(gadget.statsResult.mean)}</span>
              <span className="lbl">sd</span>
              <span className="v">{fmtNum(gadget.statsResult.std)}</span>
              <span className="lbl">min</span>
              <span className="v">{fmtNum(gadget.statsResult.min)}</span>
              <span className="lbl">max</span>
              <span className="v">{fmtNum(gadget.statsResult.max)}</span>
            </>
          )}
          {!gadget.error && gadget.mode === "differentiate" && gadget.derivResult && (
            <>
              <span className="lbl">extremum dy/dx at x=</span>
              <span className="v">{fmtNum(gadget.derivResult.extremumX)}</span>
              <span className="v">{fmtNum(gadget.derivResult.extremumDydx)}</span>
            </>
          )}
          {!gadget.busy && !gadget.error && gadget.mode === "fft" && gadget.fftPreview && (
            <>
              <span className="lbl">N</span>
              <span className="v">{gadget.fftPreview.freq.length}</span>
              <span className="lbl">window</span>
              <span className="v">{gadget.fftPreview.windowName}</span>
            </>
          )}
          {gadget.mode === "cursors" && gadget.cursorResult && (
            <span className="v">{formatMeasurement(gadget.cursorResult)}</span>
          )}
          {(gadget.mode === "fit" || gadget.mode === "fft") && (
            <Button
              size="sm"
              disabled={
                gadget.busy || (gadget.mode === "fit" ? !gadget.fitResult : !gadget.fftPreview)
              }
              onClick={gadget.commit}
            >
              {gadget.mode === "fft" ? "→ Spectrum" : "Commit"}
            </Button>
          )}
          {(gadget.mode === "fit" || gadget.mode === "integrate" || gadget.mode === "stats") && (
            <Button
              size="sm"
              disabled={
                gadget.busy ||
                gadget.reporting ||
                (gadget.mode === "fit"
                  ? !gadget.fitResult
                  : gadget.mode === "integrate"
                    ? !gadget.integrateResult
                    : !gadget.statsResult)
              }
              onClick={() => void gadget.report()}
            >
              {gadget.reporting ? "Reporting…" : "→ Report"}
            </Button>
          )}
          <button className="qzk-chip-reset" title="Clear" onClick={gadget.dismiss}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
