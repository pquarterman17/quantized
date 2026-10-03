import { useState } from "react";

import { useEscapeSurface } from "../../../lib/escapeStack";
import { quickPlotAvailability } from "../../../lib/quickPlot";
import { techniqueOf } from "../../../lib/techniqueDefaults";
import {
  TECHNIQUE_WORKFLOWS,
  workflowArtifacts,
  type TechniqueActionId,
} from "../../../lib/techniqueWorkflow";
import type { Dataset } from "../../../lib/types";
import type { Action } from "../../../store/commands";
import { runTechniqueWorkspaceAction, techniqueActionDefinition } from "../../../store/techniqueWorkspaceRun";
import { useApp } from "../../../store/useApp";
import { Badge, Button } from "../../primitives";
import { useWorkflowWorkspaceView } from "../../../lib/workflowWorkspace";
import OriginMigrationCockpit from "../originmigration/OriginMigrationCockpit";

function sourceName(ds: Dataset): string {
  const parser = ds.data.metadata.parser_name;
  if (typeof parser === "string" && parser.trim()) return parser.replace(/^import_/, "").replaceAll("_", " ");
  const format = ds.data.metadata.source_format;
  if (typeof format === "string" && format.trim()) return format;
  return ds.source?.kind === "path" ? "file import" : "not recorded";
}

function xDescription(ds: Dataset): string {
  const metadata = ds.data.metadata;
  const rawLabel = metadata.x_column_name ?? metadata.x_label;
  const rawUnit = metadata.x_column_unit ?? metadata.x_unit;
  const label = typeof rawLabel === "string" && rawLabel.trim() ? rawLabel.trim() : "x / index";
  const unit = typeof rawUnit === "string" && rawUnit.trim() ? ` (${rawUnit.trim()})` : "";
  return `${label}${unit}`;
}

function rowCount(ds: Dataset): number {
  return ds.pending?.rows ?? Math.max(ds.data.time.length, ds.data.values.length);
}

function ActionButton({ action, disabled, title, onRun }: { action: Pick<Action, "label" | "description">; disabled?: boolean; title?: string; onRun: () => void }) {
  return (
    <Button size="sm" disabled={disabled} title={title} onClick={onRun}>
      <span>{action.label}</span>
      {action.description && <small>{action.description}</small>}
    </Button>
  );
}

export default function TechniqueWorkspace({ onClose }: { onClose: () => void }) {
  const workspaceView = useWorkflowWorkspaceView();
  if (workspaceView.kind === "origin") {
    return <OriginMigrationCockpit initialFidelityId={workspaceView.fidelityId} onClose={onClose} />;
  }
  return <TechniqueWorkspaceContent onClose={onClose} />;
}

function TechniqueWorkspaceContent({ onClose }: { onClose: () => void }) {
  const activeId = useApp((s) => s.activeId);
  const dataset = useApp((s) => s.datasets.find((d) => d.id === s.activeId));
  const hasFigure = useApp((s) => s.editableFigures.some((f) => f.bindings.datasetId === s.activeId));
  const hasReport = useApp((s) => s.reports.some((r) => r.datasetId === s.activeId));
  const [busyAction, setBusyAction] = useState<TechniqueActionId | null>(null);

  useEscapeSurface("workspace", () => {
    onClose();
    return true;
  });

  if (!dataset || !activeId) {
    return (
      <section className="qzk-technique-workspace" aria-labelledby="technique-workspace-title">
        <header className="qzk-technique-head">
          <div>
            <div className="qzk-technique-eyebrow">Workflow</div>
            <h1 id="technique-workspace-title">Choose a worksheet</h1>
            <p>Select a worksheet in the Library, then return here for a technique-aware workflow.</p>
          </div>
          <Button onClick={onClose}>Back to plot</Button>
        </header>
        <div className="qzk-technique-empty">No active worksheet. Nothing was changed.</div>
      </section>
    );
  }

  const technique = techniqueOf(dataset);
  const workflow = TECHNIQUE_WORKFLOWS[technique];
  const availability = quickPlotAvailability(dataset);
  const artifacts = workflowArtifacts(dataset, hasFigure, hasReport);

  const launch = (id: TechniqueActionId): void => {
    if (busyAction) return;
    setBusyAction(id);
    void runTechniqueWorkspaceAction(id, dataset.id, onClose).finally(() => setBusyAction(null));
  };

  return (
    <section className="qzk-technique-workspace" aria-labelledby="technique-workspace-title">
      <header className="qzk-technique-head">
        <div>
          <div className="qzk-technique-eyebrow">Workflow</div>
          <h1 id="technique-workspace-title">{workflow.label}</h1>
          <p>{workflow.summary}</p>
        </div>
        <Button onClick={onClose}>Back to plot</Button>
      </header>

      <div className="qzk-technique-dataset" aria-label="Active worksheet summary">
        <div>
          <strong>{dataset.name}</strong>
          <span>{rowCount(dataset).toLocaleString()} rows · {dataset.data.labels.length} columns</span>
        </div>
        <dl>
          <div><dt>Technique</dt><dd>{workflow.label}{technique === "generic" ? " (not identified)" : ""}</dd></div>
          <div><dt>x axis</dt><dd>{xDescription(dataset)}</dd></div>
          <div><dt>Imported by</dt><dd>{sourceName(dataset)}</dd></div>
          <div><dt>Data</dt><dd>{dataset.pending ? "Preview loaded — full data will load before an action" : "Full data loaded"}</dd></div>
        </dl>
        <p className="qzk-technique-provenance">
          {technique === "generic"
            ? "No technique was declared by the import. Quantized is showing general-purpose tools instead of guessing."
            : "This workflow comes from the technique recorded during import; every action remains editable and optional."}
        </p>
        {artifacts.length > 0 && (
          <div className="qzk-technique-artifacts" aria-label="Existing results">
            <span>Existing results</span>
            {artifacts.map((artifact) => <Badge key={artifact} tone="ok">{artifact}</Badge>)}
          </div>
        )}
      </div>

      <ol className="qzk-technique-stages">
        {workflow.stages.map((stage, index) => (
          <li key={stage.title} className="qzk-technique-stage">
            <span className="qzk-technique-step" aria-hidden="true">{index + 1}</span>
            <div className="qzk-technique-stage-copy">
              <h2>{stage.title}</h2>
              <p>{stage.description}</p>
            </div>
            <div className="qzk-technique-actions">
              {stage.actions.map((id) => {
                const action = techniqueActionDefinition(id);
                if (!action) return null;
                const quickDisabled = id === "quick-plot" && !availability.available;
                return (
                  <ActionButton
                    key={id}
                    action={action}
                    disabled={quickDisabled || busyAction !== null}
                    title={quickDisabled ? availability.reason : undefined}
                    onRun={() => launch(id)}
                  />
                );
              })}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
