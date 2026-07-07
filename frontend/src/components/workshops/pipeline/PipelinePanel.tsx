// Pipeline workshop (#6) — view. The recorded macro steps as a first-class
// editable list: toggle / reorder / edit params / delete / insert an
// expression step (#7), run against the active dataset with per-step markers,
// and export the same script the macro card exports (one source of truth).
// Thin — state and the runner live in usePipeline.

import { useState } from "react";

import { saveBlob } from "../../../lib/download";
import { pipelineToScript, STEP_FIELDS, type PipelineStep } from "../../../lib/pipeline";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { Button, Checkbox, NumberField, StatusDot } from "../../primitives";
import TemplatesSection from "./TemplatesSection";
import { usePipeline, type StepStatus } from "./usePipeline";

const TONE: Record<StepStatus, "ok" | "warn" | "danger"> = {
  ok: "ok",
  skipped: "warn",
  failed: "danger",
};

/** Inline param editor for a selected step: schema fields for known kinds,
 *  read-only code for ui steps. */
function StepEditor({
  step,
  onParams,
  validate,
}: {
  step: PipelineStep;
  onParams: (params: Record<string, unknown>) => void;
  validate: (expr: string) => string | null;
}) {
  const fields = STEP_FIELDS[step.kind];
  const [draft, setDraft] = useState<Record<string, unknown>>({ ...step.params });
  if (!fields) {
    return (
      <div className="qzk-step-editor">
        <code className="qzk-step-code">{step.code}</code>
        {step.kind === "correction" && (
          <div className="qzk-ds-meta" style={{ color: "var(--text-faint)", marginTop: 4 }}>
            Re-runs these corrections on the active dataset. Edit by re-recording.
          </div>
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

export default function PipelinePanel() {
  const setOpen = useApp((s) => s.setPipelineOpen);
  const setStatus = useApp((s) => s.setStatus);
  const p = usePipeline();
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newExpr, setNewExpr] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  return (
    <ToolWindow title="Pipeline" width={440} onClose={() => setOpen(false)}>
      {p.steps.length === 0 ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          No steps yet — turn on the macro recorder (Inspector ▸ Macro recorder) and work
          normally, or add an expression step below.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 260, overflowY: "auto" }}>
          {p.steps.map((s) => {
            const log = p.runLog[s.id];
            return (
              <div key={s.id}>
                <div
                  className={`qzk-step-row${selected === s.id ? " qzk-active" : ""}`}
                  onClick={() => setSelected(selected === s.id ? null : s.id)}
                >
                  {/* stop propagation so toggling never also selects the row */}
                  <span onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={s.enabled} onChange={() => p.toggleStep(s.id)} />
                  </span>
                  <span className="qzk-step-kind">{s.kind}</span>
                  <span className="qzk-step-label" style={s.enabled ? undefined : { opacity: 0.45 }}>
                    {s.label}
                  </span>
                  {log && <StatusDot tone={TONE[log.status]} label={log.note ?? log.status} />}
                  <span style={{ flex: 1 }} />
                  <button className="qz-btn qz-ghost qz-sm" title="move up" onClick={(e) => { e.stopPropagation(); p.moveStep(s.id, -1); }}>↑</button>
                  <button className="qz-btn qz-ghost qz-sm" title="move down" onClick={(e) => { e.stopPropagation(); p.moveStep(s.id, 1); }}>↓</button>
                  <button className="qz-btn qz-ghost qz-sm" title="delete step" onClick={(e) => { e.stopPropagation(); p.removeStep(s.id); }}>×</button>
                </div>
                {selected === s.id && (
                  <StepEditor
                    step={s}
                    validate={p.validate}
                    onParams={(params) => p.updateStepParams(s.id, params)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* #7: author a no-code expression step directly. */}
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end", marginTop: 10 }}>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">new column</label>
          <NumberField numeric={false} width={90} value={newName} onChange={setNewName} placeholder="name" />
        </span>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">expression</label>
          <NumberField numeric={false} width={150} value={newExpr} onChange={setNewExpr} placeholder="A / B" />
        </span>
        <Button
          size="sm"
          onClick={() => {
            const err = p.addExpressionStep(newName.trim(), newExpr.trim());
            setAddError(err);
            if (!err) {
              setNewName("");
              setNewExpr("");
            }
          }}
        >
          + Step
        </Button>
      </div>
      {addError && (
        <div className="qzk-ds-meta" style={{ color: "var(--danger)", marginTop: 4 }}>
          {addError}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <Button
          variant="primary"
          size="sm"
          disabled={p.running || !p.active || p.steps.length === 0}
          onClick={() => void p.run()}
        >
          {p.running ? "Running…" : `Run on ${p.active?.name ?? "…"}`}
        </Button>
        <span style={{ flex: 1 }} />
        <Button
          size="sm"
          disabled={p.steps.length === 0}
          onClick={() => {
            saveBlob(
              new Blob([pipelineToScript(p.steps)], { type: "text/plain" }),
              "pipeline.qzm",
            );
            setStatus(`saved pipeline.qzm — ${p.steps.length} steps`);
          }}
        >
          Export script
        </Button>
      </div>

      <TemplatesSection />
    </ToolWindow>
  );
}
