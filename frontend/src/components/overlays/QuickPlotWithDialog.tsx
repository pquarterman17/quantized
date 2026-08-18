// "Quick Plot With..." chooser (plan PR H5b, L0.36-L0.38): lists every
// saved Quick Plot template in scope for the target dataset. A resolvable
// template (`resolveTemplate` -- lib/quickPlotTemplates.ts, H4) applies on
// click, delegating through `applyQuickPlotTemplate` to the ONE canonical
// create path; a mismatched one stays visibly listed but DISABLED with its
// unmatched fields named as the reason (L0.36's "disable ... with a short
// reason rather than removing them unpredictably"). Rows carry inline
// rename/delete -- this dialog IS the manage surface (no new Library node
// kind, per the frozen contract). Modal-backdrop convention borrowed from
// SplitDatasetDialog/ParamDialog.
//
// Review-round fix (P2b, the manage-affordance-must-not-be-scope-hostage
// case): a workbook can be opened here in one of two mutually exclusive
// modes (`useQuickPlotWithDialog`'s `datasetId` xor `workbookId`) --
// worksheet mode (the normal case, resolves for real) or WORKBOOK-ONLY mode
// (the workbook menu opens this when the workbook has zero current
// worksheet children but still owns workbook-scoped templates): there is no
// dataset to resolve against, so every row renders disabled with the honest
// "workbook has no worksheets" reason, but rename/delete stay fully
// functional -- a memberless-but-ALIVE workbook must not lose the ability to
// manage the templates scoped to it.

import { useState } from "react";

import { quickPlotTemplateInScope, resolveTemplate, type QuickPlotTemplateResolution } from "../../lib/quickPlotTemplates";
import { Button } from "../primitives";
import { useApp } from "../../store/useApp";
import { useQuickPlotWithDialog } from "../../store/quickPlotWithDialog";

const NO_WORKSHEETS: QuickPlotTemplateResolution = { ok: false, unmatched: [], reason: "workbook has no worksheets" };

export default function QuickPlotWithDialog() {
  const datasetId = useQuickPlotWithDialog((s) => s.datasetId);
  const workbookId = useQuickPlotWithDialog((s) => s.workbookId);
  const close = useQuickPlotWithDialog((s) => s.close);
  const dataset = useApp((s) => (datasetId ? s.datasets.find((d) => d.id === datasetId) : undefined));
  const templates = useApp((s) => s.quickPlotTemplates);
  const applyTemplate = useApp((s) => s.applyQuickPlotTemplate);
  const renameTemplate = useApp((s) => s.renameQuickPlotTemplate);
  const deleteTemplate = useApp((s) => s.deleteQuickPlotTemplate);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Hooks above run unconditionally (same discipline as SplitDatasetDialog)
  // -- the "closed" and "dataset vanished" returns come after.
  if (datasetId === null && workbookId === null) return null;

  const commitRename = (id: string): void => {
    renameTemplate(id, renameValue);
    setRenamingId(null);
  };

  if (datasetId !== null && !dataset) {
    return (
      <div className="qz-overlay-backdrop" onMouseDown={close}>
        <div className="qzk-glass qz-dialog" onMouseDown={(e) => e.stopPropagation()}>
          <h2>Quick Plot With…</h2>
          <p className="qzk-ds-meta">The source worksheet was removed.</p>
          <div className="qz-btn-row"><Button onClick={close}>Close</Button></div>
        </div>
      </div>
    );
  }

  // Worksheet mode resolves for real against the live dataset; workbook-only
  // mode (dataset is null, workbookId is set) lists just that workbook's OWN
  // workbook-scoped templates, each honestly unresolvable for the same
  // reason (no worksheet to plot against yet).
  const rows = dataset
    ? templates.filter((t) => quickPlotTemplateInScope(t, dataset)).map((t) => ({ template: t, resolution: resolveTemplate(t, dataset) }))
    : templates
        .filter((t) => t.scope.kind === "workbook" && t.scope.workbookId === workbookId)
        .map((t) => ({ template: t, resolution: NO_WORKSHEETS }));

  const emptyMessage = dataset
    ? `No saved Quick Plot templates apply to “${dataset.name}” yet.`
    : "No Quick Plot templates are scoped to this workbook yet.";

  return (
    <div className="qz-overlay-backdrop" onMouseDown={close}>
      <div
        className="qzk-glass qz-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
          e.stopPropagation();
        }}
      >
        <h2>Quick Plot With…</h2>
        {rows.length === 0 && <p className="qzk-ds-meta">{emptyMessage}</p>}
        <ul className="qzk-quickplotwith-list" style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
          {rows.map(({ template, resolution }) => (
            <li key={template.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {renamingId === template.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  aria-label={`Rename ${template.name}`}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(template.id);
                    if (e.key === "Escape") setRenamingId(null);
                    e.stopPropagation();
                  }}
                  onBlur={() => commitRename(template.id)}
                />
              ) : (
                <button
                  type="button"
                  className="qz-btn"
                  style={{ flex: 1, textAlign: "left" }}
                  disabled={!resolution.ok}
                  title={resolution.ok ? "" : resolution.reason}
                  onClick={() => {
                    if (dataset && applyTemplate(template.id, dataset.id)) close();
                  }}
                >
                  {template.name}
                  {!resolution.ok && <span className="qzk-ds-meta"> — {resolution.reason}</span>}
                </button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  setRenamingId(template.id);
                  setRenameValue(template.name);
                }}
              >
                Rename
              </Button>
              <Button size="sm" variant="danger" onClick={() => deleteTemplate(template.id)}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
        <div className="qz-btn-row">
          <Button onClick={close}>Close</Button>
        </div>
      </div>
    </div>
  );
}
