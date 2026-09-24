// Reflectivity workshop — Fit mode body: data binding, parameter table,
// Run/Cancel, the error line and the results with their follow-up actions.
// Thin: all state lives in useReflFit (owned by ReflectivityPanel so it
// survives a Model ⇄ Fit switch). Slice 3: the history picker, and a saved
// fit (SavedFit) whenever the picked fit is not the one just run.

import { Button } from "../../primitives";
import FitDataBinding from "./FitDataBinding";
import FitParamTable from "./FitParamTable";
import FitResults from "./FitResults";
import SavedFit, { FitHistoryPicker } from "./SavedFit";
import type { ReflFitState } from "./useReflFit";

const SECTION = { marginTop: 12, marginBottom: 6 } as const;

export default function ReflFitView({ fit }: { fit: ReflFitState }) {
  const lambdaMissing = fit.settings.xKind === "twotheta" && fit.lambda == null;
  const h = fit.history;
  const live = fit.result != null && (h.pickedId === null || h.pickedId === fit.liveRecord?.id);
  return (
    <div>
      <div className="qzk-field-lbl" style={SECTION}>Data</div>
      <FitDataBinding fit={fit} />

      <div className="qzk-field-lbl" style={SECTION}>Parameters</div>
      <FitParamTable rows={fit.params} onChange={fit.setParam} />

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <Button
          variant="primary"
          size="sm"
          disabled={fit.busy || fit.channels.length === 0 || lambdaMissing}
          onClick={() => void fit.run()}
        >
          {fit.busy ? "Fitting…" : "Run fit"}
        </Button>
        <Button size="sm" disabled={!fit.busy} onClick={fit.cancel}>
          Cancel
        </Button>
      </div>

      {fit.error && (
        <div className="qzk-ds-meta qzk-msg" role="alert" style={{ marginTop: 10, color: "var(--danger)" }}>
          {fit.error}
        </div>
      )}

      <FitHistoryPicker fit={fit} showingLive={live} />
      {!live && <SavedFit fit={fit} />}

      {live && fit.result && (
        <>
          <div className="qzk-field-lbl" style={SECTION}>Result</div>
          <FitResults result={fit.result} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            <Button size="sm" disabled={fit.applyBlocked != null} title={fit.applyBlocked ?? undefined} onClick={fit.applyToModel}>
              Apply to model
            </Button>
            <Button size="sm" disabled={fit.curvesAdded} onClick={() => void fit.addCurves()}>
              {fit.curvesAdded ? "Fit curves added" : "Add fit curves"}
            </Button>
            <Button size="sm" onClick={fit.openLogPlot}>
              Open log-Y plot
            </Button>
            {fit.liveRecord && (
              <Button size="sm" disabled={h.reporting} onClick={() => fit.liveRecord && void h.addToReport(fit.liveRecord)}>
                Add to report
              </Button>
            )}
          </div>
          {fit.applyBlocked && (
            <div className="qzk-ds-meta qzk-msg" role="note" style={{ marginTop: 6, color: "var(--warn)" }}>
              Apply is unavailable: {fit.applyBlocked}.
            </div>
          )}
          <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>
            The fitted curve of channel 1 is overlaid on its dataset; the fit curves add every channel and SLD profile.
          </div>
        </>
      )}
    </div>
  );
}
