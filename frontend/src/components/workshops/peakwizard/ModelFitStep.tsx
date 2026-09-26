// Peak Analyzer step ④ for the mixed-shape model engine (audit P2.4 slice 2):
// run / cancel `/api/peaks/model-fit` over the wizard's fitted x-range, show
// the backend's ASCII error detail verbatim, then the result and a preview.
// "Start from fit" copies the fitted values into the step-③ start values.

import { Button } from "../../primitives";
import ModelFitPreview from "./ModelFitPreview";
import ModelFitResults from "./ModelFitResults";
import { SetupProblems } from "./ModelSetupView";
import type { PeakWizardState } from "./usePeakWizard";

const faint = { color: "var(--text-faint)" } as const;

export default function ModelFitStep({ w }: { w: PeakWizardState }) {
  const m = w.model;
  const r = m.result;
  const n = m.setup.shapes.length;
  return (
    <>
      <div className="qzk-ds-meta" style={{ ...faint, marginBottom: 6 }}>
        {n} peak(s) · {m.setup.background} background · {m.setup.params.filter((p) => p.vary && !p.tie).length} free
        parameters (edit them in step 3)
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Button
          size="sm"
          variant="primary"
          disabled={m.busy || n === 0 || m.problems.length > 0}
          title={m.problems.length > 0 ? "fix the parameter table (step 3) first" : undefined}
          onClick={() => void m.run()}
        >
          {m.busy ? "Fitting…" : r ? "Re-fit" : "Fit"}
        </Button>
        {m.busy && (
          <Button size="sm" onClick={m.cancel}>
            Cancel
          </Button>
        )}
        {r && !m.busy && (
          <Button size="sm" variant="ghost" title="use the fitted values as the next start" onClick={m.startFromResult}>
            Start from fit
          </Button>
        )}
        {r && !m.busy && (
          <Button
            size="sm"
            disabled={m.publishBlock !== null || m.publishing}
            title={m.publishBlock ?? "save these peaks, with their errors and shapes, as this dataset's peak table"}
            onClick={() => void m.publishToTable()}
          >
            Publish to peak table
          </Button>
        )}
      </div>
      {r && !m.busy && m.publishBlock && (
        <div className="qzk-ds-meta" style={{ ...faint, marginTop: 6 }}>
          Not publishable: {m.publishBlock}
        </div>
      )}
      {m.publishNote && (
        <div
          role="status"
          className="qzk-ds-meta"
          style={{ color: m.publishNote.ok ? "var(--ok)" : "var(--danger)", marginTop: 6 }}
        >
          {m.publishNote.text}
        </div>
      )}
      <SetupProblems problems={m.problems} />
      {m.error && (
        <div role="alert" className="qzk-ds-meta qzk-msg" style={{ color: "var(--danger)", marginTop: 6 }}>
          {m.error}
        </div>
      )}
      {m.notice && (
        <div className="qzk-ds-meta" style={{ ...faint, marginTop: 6 }}>
          {m.notice}
        </div>
      )}
      {r && m.stale && (
        <div className="qzk-ds-meta" style={{ color: "var(--warn)", marginTop: 6 }}>
          The parameters changed since this fit — its curves are off the plot and it cannot be
          integrated or reported until you Re-fit.
        </div>
      )}
      {r && (
        <>
          <ModelFitResults r={r} />
          <ModelFitPreview r={r} />
        </>
      )}
    </>
  );
}
