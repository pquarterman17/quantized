// Pipeline panel — the inline param editor for the selected step (split out
// of PipelinePanel.tsx). Schema fields for expression / fit steps
// (lib/pipeline STEP_FIELDS), the lazy TransformStepEditor for a `transform`
// step (audit P2.5), read-only code for the rest. Every Apply goes through
// `onParams`, which the panel wires to the undoable `editStep`.

import { lazy, Suspense, useState } from "react";

import { IN_PLACE_OPS } from "../../../lib/metadataRun";
import { STEP_FIELDS, type PipelineStep } from "../../../lib/pipeline";
import { NumberField } from "../../primitives/NumberField";
import { Button } from "../../primitives";

const TransformStepEditor = lazy(() => import("./TransformStepEditor"));

const faint = { color: "var(--text-faint)", marginTop: 4 };

export default function StepEditor({
  step,
  onParams,
  validate,
}: {
  step: PipelineStep;
  onParams: (params: Record<string, unknown>, text?: { label: string; code: string }) => void;
  validate: (expr: string) => string | null;
}) {
  const fields = STEP_FIELDS[step.kind];
  const [draft, setDraft] = useState<Record<string, unknown>>({ ...step.params });
  if (!fields) {
    return (
      <div className="qzk-step-editor">
        <code className="qzk-step-code">{step.code}</code>
        {step.kind === "correction" && (
          <div className="qzk-ds-meta" style={faint}>
            Re-runs these corrections on the active dataset. Edit by re-recording.
          </div>
        )}
        {step.kind === "transform" && (
          <>
            <div className="qzk-ds-meta" style={faint}>
              {typeof step.params.op === "string" && IN_PLACE_OPS.has(step.params.op)
                ? "Edits the current dataset in place (a metadata factor column, or its metadata); later steps continue on it."
                : "Derives a new dataset from the current one; later steps continue on it. A second input is the recorded dataset (matched by id — the step fails if it is no longer in this workspace)."}
            </div>
            <Suspense fallback={null}>
              <TransformStepEditor step={step} onApply={onParams} />
            </Suspense>
          </>
        )}
      </div>
    );
  }
  const exprError =
    step.kind === "expression" ? validate(String(draft.expr ?? "")) : null;
  return (
    <div className="qzk-step-editor">
      {fields.map((f) => (
        <span key={f.key} style={{ display: "inline-flex", flexDirection: "column", gap: 2, marginRight: 8 }}>
          <label className="qzk-field-lbl">{f.label}</label>
          <NumberField
            numeric={false}
            width={f.key === "expr" ? 180 : 110}
            value={String(draft[f.key] ?? "")}
            onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
          />
        </span>
      ))}
      <Button
        size="sm"
        disabled={!!exprError}
        onClick={() => onParams(draft)}
        style={{ verticalAlign: "bottom" }}
      >
        Apply
      </Button>
      {exprError && (
        <div className="qzk-ds-meta" style={{ color: "var(--danger)", marginTop: 4 }}>
          {exprError}
        </div>
      )}
    </div>
  );
}
