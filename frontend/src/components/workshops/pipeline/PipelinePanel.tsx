// Pipeline workshop (#6) — view. The recorded macro steps as a first-class
// editable list: toggle / reorder / edit params / delete / insert an
// expression step (#7), run against the active dataset with per-step markers,
// and export the same script the macro card exports (one source of truth).
// Thin — state and the runner live in usePipeline.

import { useEffect, useRef, useState } from "react";

import { saveBlob } from "../../../lib/download";
import { pipelineToScript } from "../../../lib/pipeline";
import {
  pipelineEditImpact,
  type PipelineEditImpact,
} from "../../../lib/pipelineStudio";
import { pipelineStepsAfterEdit, type PipelineStructuralAction } from "../../../lib/pipelineStructuralEdit";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { Button, StatusDot } from "../../primitives";
import StepEditor from "./StepEditor";
import TemplatesSection from "./TemplatesSection";
import ProposedPipelineResult from "./ProposedPipelineResult";
import type { PipelineEditPreview as EditPreview } from "./pipelineEditPreview";
import { usePipeline, type StepStatus } from "./usePipeline";

const TONE: Record<StepStatus, "ok" | "warn" | "danger"> = {
  ok: "ok",
  skipped: "warn",
  failed: "danger",
  warn: "warn",
};

interface PendingEdit {
  stepId: string;
  action: PipelineStructuralAction;
  impact: PipelineEditImpact;
  preview: EditPreview | null;
}

const STATE_LABEL = {
  ready: "Ready",
  display_only: "Script only",
  input: "Input",
  disabled: "Off",
  invalid: "Needs attention",
  blocked: "Blocked",
} as const;

export default function PipelinePanel() {
  const setOpen = useApp((s) => s.setPipelineOpen);
  const setStatus = useApp((s) => s.setStatus);
  const p = usePipeline();
  const datasets = useApp((s) => s.datasets);
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newExpr, setNewExpr] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const previewRequest = useRef(0);

  // Undo, template load, or another command can replace the list while a
  // confirmation is open. Never apply wording calculated for an old list.
  useEffect(() => {
    previewRequest.current += 1;
    setPendingEdit(null);
  }, [datasets, p.active?.id, p.steps]);
  useEffect(() => {
    if (selected && !p.steps.some((step) => step.id === selected)) setSelected(null);
  }, [p.steps, selected]);

  const applyStructuralEdit = (stepId: string, action: PipelineStructuralAction) => {
    if (action === "toggle") p.toggleStep(stepId);
    else if (action === "remove") p.removeStep(stepId);
    else p.moveStep(stepId, action === "move_up" ? -1 : 1);
    setPendingEdit(null);
  };

  const requestStructuralEdit = (stepId: string, action: PipelineStructuralAction) => {
    const impact = pipelineEditImpact(p.steps, stepId, action);
    if (!impact.requiresConfirmation) {
      applyStructuralEdit(stepId, action);
      return;
    }
    const request = ++previewRequest.current;
    const proposed = pipelineStepsAfterEdit(p.steps, stepId, action);
    setPendingEdit({ stepId, action, impact, preview: null });
    void import("./pipelineEditPreview").then(({ previewPipelineEdit }) => (
      previewPipelineEdit(proposed, p.active, datasets)
    )).then((preview) => {
      if (previewRequest.current !== request) return;
      setPendingEdit((current) => current?.stepId === stepId && current.action === action
        ? { ...current, preview }
        : current);
    }).catch((error: unknown) => {
      if (previewRequest.current !== request) return;
      const preview: EditPreview = {
        status: "unavailable",
        input: null,
        output: null,
        warnings: [error instanceof Error ? error.message : "The proposed result could not be previewed."],
        capped: false,
        canCommit: true,
      };
      setPendingEdit((current) => current?.stepId === stepId && current.action === action
        ? { ...current, preview }
        : current);
    });
  };

  const reviewById = new Map(p.review.steps.map((step) => [step.id, step]));
  const activeMeta = p.active
    ? `${p.active.data.time.length.toLocaleString()} rows · ${p.active.data.labels.length.toLocaleString()} columns${p.active.pending ? " · full data loads before run" : ""}`
    : "Choose a worksheet before running this pipeline.";

  return (
    <ToolWindow id="pipeline" title="Pipeline Studio" width={720} onClose={() => setOpen(false)}>
      <section className="qzk-pipeline-overview" aria-label="Pipeline overview">
        <div className="qzk-pipeline-overview-head">
          <div>
            <div className="qzk-pipeline-eyebrow">CURRENT INPUT</div>
            <strong>{p.active?.name ?? "No worksheet selected"}</strong>
            <div className="qzk-ds-meta">{activeMeta}</div>
          </div>
          <div className="qzk-pipeline-counts" aria-label="Step compatibility summary">
            <span>{p.review.runnable} runnable</span>
            <span>{p.review.displayOnly} script only</span>
            {p.review.inputs > 0 && <span>{p.review.inputs} input marker{p.review.inputs === 1 ? "" : "s"}</span>}
            {p.review.disabled > 0 && <span>{p.review.disabled} off</span>}
            {p.review.blocked > 0 && <span className="qzk-pipeline-count-warn">{p.review.blocked} blocked</span>}
            {p.review.invalid > 0 && <span className="qzk-pipeline-count-danger">{p.review.invalid} invalid</span>}
          </div>
        </div>
        {p.review.invalid > 0 && (
          <div className="qzk-pipeline-alert" role="alert">
            Fix the steps marked “Needs attention” before running. Nothing has been changed.
          </div>
        )}
      </section>

      {p.steps.length === 0 ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          No steps yet — turn on the macro recorder (Inspector ▸ Macro recorder) and work
          normally, or add an expression step below.
        </div>
      ) : (
        <div className="qzk-pipeline-list">
          {p.steps.map((s, index) => {
            const log = p.runLog[s.id];
            const review = reviewById.get(s.id)!;
            const confirming = pendingEdit?.stepId === s.id ? pendingEdit : null;
            return (
              <div key={s.id} className="qzk-pipeline-step">
                <div
                  className={`qzk-step-row${selected === s.id ? " qzk-active" : ""}`}
                  onClick={() => setSelected(selected === s.id ? null : s.id)}
                >
                  {/* stop propagation so toggling never also selects the row */}
                  <span onClick={(e) => e.stopPropagation()}>
                    <Checkbox disabled={p.running} checked={s.enabled} onChange={() => requestStructuralEdit(s.id, "toggle")} />
                  </span>
                  <span className="qzk-step-kind">{s.kind}</span>
                  <span className="qzk-step-copy" style={s.enabled ? undefined : { opacity: 0.55 }}>
                    <span className="qzk-step-label">{s.label}</span>
                    <span className="qzk-step-summary">{review.summary}</span>
                    <span className="qzk-step-impact">{review.impact}</span>
                  </span>
                  <span className={`qzk-step-state qzk-step-state-${review.state}${review.state === "ready" && review.issue ? " qzk-step-state-warning" : ""}`}>
                    {review.state === "ready" && review.issue ? "Ready with fallback" : STATE_LABEL[review.state]}
                  </span>
                  {log && <StatusDot tone={TONE[log.status]} label={log.status} />}
                  <span style={{ flex: 1 }} />
                  <button aria-label="Move up" disabled={p.running || index === 0} className="qz-btn qz-ghost qz-sm" title="move up" onClick={(e) => { e.stopPropagation(); requestStructuralEdit(s.id, "move_up"); }}>↑</button>
                  <button aria-label="Move down" disabled={p.running || index === p.steps.length - 1} className="qz-btn qz-ghost qz-sm" title="move down" onClick={(e) => { e.stopPropagation(); requestStructuralEdit(s.id, "move_down"); }}>↓</button>
                  <button aria-label="Duplicate step" disabled={p.running} className="qz-btn qz-ghost qz-sm" title="duplicate step" onClick={(e) => { e.stopPropagation(); p.duplicateStep(s.id); }}>⧉</button>
                  <button aria-label="Delete step" disabled={p.running} className="qz-btn qz-ghost qz-sm" title="delete step" onClick={(e) => { e.stopPropagation(); requestStructuralEdit(s.id, "remove"); }}>×</button>
                </div>
                {(review.issue || log?.note) && (
                  <div className={`qzk-step-note${review.state === "invalid" ? " qzk-step-note-danger" : ""}`}>
                    {log?.note ?? review.issue}
                  </div>
                )}
                {confirming && (
                  <div className="qzk-pipeline-confirm" role="group" aria-live="polite" aria-label={confirming.impact.title}>
                    <div className="qzk-pipeline-confirm-copy">
                      <div><strong>{confirming.impact.title}</strong> {confirming.impact.detail}</div>
                      <ProposedPipelineResult preview={confirming.preview} />
                    </div>
                    <div className="qzk-pipeline-confirm-actions">
                      <Button
                        size="sm"
                        disabled={!confirming.preview?.canCommit}
                        onClick={() => applyStructuralEdit(confirming.stepId, confirming.action)}
                      >
                        {confirming.preview ? "Confirm" : "Previewing…"}
                      </Button>
                      <Button size="sm" onClick={() => {
                        previewRequest.current += 1;
                        setPendingEdit(null);
                      }}>Cancel</Button>
                    </div>
                  </div>
                )}
                {selected === s.id && p.running && (
                  <div className="qzk-ds-meta qzk-step-note">Editing is paused while this run finishes.</div>
                )}
                {selected === s.id && !p.running && (
                  <StepEditor
                    // Re-seed the draft when the step changes under it (undo/redo).
                    key={`${s.code}\n${JSON.stringify(s.params)}`}
                    step={s}
                    validate={p.validate}
                    onParams={(params, text) => p.editStep(s.id, params, text)}
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
          disabled={p.running}
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
          disabled={p.running || pendingEdit !== null || p.steps.length === 0 || !p.review.canRun}
          title={!p.review.canRun ? "Resolve invalid steps before running" : undefined}
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

      {p.lastRun && (
        <section className={`qzk-pipeline-result${p.lastRun.failed ? " qzk-pipeline-result-failed" : ""}`} aria-label="Last pipeline run">
          <strong>{p.lastRun.failed ? "Run finished with errors" : "Run complete"}</strong>
          <span>{p.lastRun.inputName} → {p.lastRun.outputName}</span>
          <span>{p.lastRun.ok} completed · {p.lastRun.warned} warnings · {p.lastRun.failed} failed · {p.lastRun.skipped} skipped</span>
          {p.lastRun.createdNames.length > 0 && <span>Created: {p.lastRun.createdNames.join(", ")}</span>}
        </section>
      )}

      <TemplatesSection />
    </ToolWindow>
  );
}
