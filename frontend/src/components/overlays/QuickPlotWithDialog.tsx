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

import { useState } from "react";

import { quickPlotTemplateInScope, resolveTemplate } from "../../lib/quickPlotTemplates";
import { Button } from "../primitives";
import { useApp } from "../../store/useApp";
import { useQuickPlotWithDialog } from "../../store/quickPlotWithDialog";

export default function QuickPlotWithDialog() {
  const datasetId = useQuickPlotWithDialog((s) => s.datasetId);
  const close = useQuickPlotWithDialog((s) => s.close);
  const dataset = useApp((s) => s.datasets.find((d) => d.id === datasetId));
  const templates = useApp((s) => s.quickPlotTemplates);
  const applyTemplate = useApp((s) => s.applyQuickPlotTemplate);
  const renameTemplate = useApp((s) => s.renameQuickPlotTemplate);
  const deleteTemplate = useApp((s) => s.deleteQuickPlotTemplate);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Hooks above run unconditionally (same discipline as SplitDatasetDialog)
  // -- the "closed" and "dataset vanished" returns come after.
  if (datasetId === null) return null;

  const commitRename = (id: string): void => {
    renameTemplate(id, renameValue);
    setRenamingId(null);
  };

  if (!dataset) {
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

  const rows = templates
    .filter((t) => quickPlotTemplateInScope(t, dataset))
    .map((t) => ({ template: t, resolution: resolveTemplate(t, dataset) }));

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
        {rows.length === 0 && (
          <p className="qzk-ds-meta">No saved Quick Plot templates apply to “{dataset.name}” yet.</p>
        )}
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
                    if (applyTemplate(template.id, dataset.id)) close();
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
