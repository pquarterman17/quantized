// Reflectivity workshop — Fit mode body: data binding, parameter table,
// Run/Cancel, the error line and the results with their follow-up actions.
// Thin: all state lives in useReflFit (owned by ReflectivityPanel so it
// survives a Model ⇄ Fit switch).

import { Button } from "../../primitives";
import FitDataBinding from "./FitDataBinding";
import FitParamTable from "./FitParamTable";
import FitResults from "./FitResults";
import type { ReflFitState } from "./useReflFit";

const SECTION = { marginTop: 12, marginBottom: 6 } as const;

export default function ReflFitView({ fit }: { fit: ReflFitState }) {
  const lambdaMissing = fit.settings.xKind === "twotheta" && fit.lambda == null;
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

      {fit.result && (
        <>
          <div className="qzk-field-lbl" style={SECTION}>Result</div>
          <FitResults result={fit.result} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            <Button size="sm" onClick={fit.applyToModel}>
              Apply to model
            </Button>
            <Button size="sm" disabled={fit.curvesAdded} onClick={() => void fit.addCurves()}>
              {fit.curvesAdded ? "Fit curves added" : "Add fit curves"}
            </Button>
            <Button size="sm" onClick={fit.openLogPlot}>
              Open log-Y plot
            </Button>
          </div>
          <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>
            The fitted curve of channel 1 is overlaid on its dataset; the fit curves add every channel and SLD profile.
          </div>
        </>
      )}
    </div>
  );
}
