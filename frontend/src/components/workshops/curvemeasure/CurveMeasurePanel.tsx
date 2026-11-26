// Curve measurements — view. Intersection of two curves, level crossings and
// rise / fall time, measured on the raw data as drawn (straight lines between
// samples). Logic lives in useCurveMeasure; the controls and the readout are
// their own components.

import ToolWindow from "../../overlays/ToolWindow";
import ReopenBanner from "../resultcommit/ReopenBanner";
import { useReopenScope } from "../resultcommit/useReopenSession";
import { Button } from "../../primitives";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import AnalysisInputSummary from "../analysisselection/AnalysisInputSummary";
import CurveMeasureControls from "./CurveMeasureControls";
import CurveMeasureReadout from "./CurveMeasureReadout";
import { useCurveMeasure } from "./useCurveMeasure";

function CurveMeasurePanelBody() {
  const hide = useAnalysisExtras((s) => s.hide);
  const g = useCurveMeasure();
  return (
    <ToolWindow id="curve-measure" title="Curve measurements" width={460} onClose={() => hide("curve-measure")}>
      <ReopenBanner tool="curve-measure" />
      {!g.hasData ? (
        <div className="qzk-helptext">Select a dataset with an X column and at least one Y column.</div>
      ) : (
        <>
          <AnalysisInputSummary inputs={g.inputs} />
          <CurveMeasureControls g={g} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <Button variant="primary" size="sm" disabled={g.busy} onClick={() => void g.run()}>
              {g.busy ? "Measuring…" : "Measure"}
            </Button>
          </div>
          {g.error && (
            <div className="qzk-ds-meta" role="alert" style={{ marginTop: 10, color: "var(--warn)" }}>
              {g.error}
            </div>
          )}
          <CurveMeasureReadout g={g} />
          {g.result && (
            <div style={{ marginTop: 10 }}>
              <Button
                size="sm"
                disabled={!!g.addDisabledReason}
                title={g.addDisabledReason ?? "Add the measured positions as a new dataset"}
                onClick={g.add}
              >
                {g.replacing ? `Replace “${g.replacing}”` : "Add measurements as dataset"}
              </Button>
            </div>
          )}
        </>
      )}
    </ToolWindow>
  );
}

/** Remounts the body for each "Open in <tool>" session (it seeds once, at mount). */
export default function CurveMeasurePanel() {
  return <CurveMeasurePanelBody key={useReopenScope("curve-measure")} />;
}
