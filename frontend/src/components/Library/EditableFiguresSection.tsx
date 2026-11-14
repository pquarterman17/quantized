// Canonical, reopenable figure documents. Kept separate from Publication
// figures so users can tell an editable plot from an export-preview artifact.
import { useState } from "react";

import { pagesReferencingFigure } from "../../lib/pageDocumentActions";
import { onLoadFailure, runLazy } from "../../lib/runLazy";
import { transformProvenanceOfData, transformProvenanceOfDataset, transformRecipeLabel } from "../../lib/transformProvenance";
import { toast } from "../../store/toasts";
import { SESSION_BUSY_MSG } from "../../store/figureLifecycle";
import { figurePublicationSourceUnavailable } from "../../store/figurePublicationLibrary";
import { LIBRARY_NODE_GLYPH, LIBRARY_NODE_LABEL } from "./nodeIcons";
import { useApp } from "../../store/useApp";
import { askConfirm } from "../overlays/ConfirmDialog";

export default function EditableFiguresSection() {
  const documents = useApp((state) => state.editableFigures);
  const datasets = useApp((state) => state.datasets);
  const pages = useApp((state) => state.pages);
  const open = useApp((state) => state.openEditableFigure);
  const rename = useApp((state) => state.renameEditableFigure);
  const duplicate = useApp((state) => state.duplicateEditableFigure);
  const remove = useApp((state) => state.deleteEditableFigure);
  const publicationSession = useApp((state) => state.figurePublicationSession);
  const previewInPlace = useApp((state) => state.beginFigurePublicationEditForFigure);
  const [collapsed, setCollapsed] = useState(false);
  // N10: figures ticked for the one-PDF export, in tick order (= page order).
  const [ticked, setTicked] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const live = ticked.filter((id) => documents.some((document) => document.id === id));
  const tick = (id: string) => setTicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  const exportPdf = () => {
    setExporting(true);
    void runLazy("Loading figure export…", () => import("../../store/exportSavedFigures"))
      .then((m) => m.exportSavedFiguresPdf(live, "figures"), onLoadFailure)
      .then((n) => {
        if (n) toast(`exported ${n} figure${n === 1 ? "" : "s"} as one PDF`);
      })
      .catch((error: unknown) => toast(`PDF export failed: ${error instanceof Error ? error.message : String(error)}`, "danger"))
      .finally(() => setExporting(false));
  };

  if (documents.length === 0) return null;

  return (
    <div className="qzk-lib-group">
      <button className="qzk-group-head" onClick={() => setCollapsed((value) => !value)}>
        <span className="qzk-group-caret">{collapsed ? "▸" : "▾"}</span>
        <span className="qzk-group-name">Editable figures</span>
        <span className="qzk-group-count">{documents.length}</span>
      </button>
      {!collapsed && live.length > 0 && (
        <div className="qzk-fig-row">
          <button
            className="qz-btn qz-sm"
            disabled={exporting}
            aria-label={`Export ${live.length} figure${live.length === 1 ? "" : "s"} as one PDF`}
            title="one multi-page PDF, one page per ticked figure, in the order you ticked them"
            onClick={exportPdf}
          >
            Export PDF ({live.length})
          </button>
        </div>
      )}
      {!collapsed && documents.map((document) => {
        const dataset = datasets.find((candidate) => candidate.id === document.bindings.datasetId);
        const transformProvenance = transformProvenanceOfDataset(dataset) ??
          transformProvenanceOfData(document.data.mode === "frozen" ? document.data.snapshot : null);
        // Same readiness gate beginFigurePublicationEditForFigure enforces at
        // click time -- computed here too so the button can fail closed with
        // a tooltip instead of only a post-click toast (SESSION_BUSY_MSG is
        // the identical wording the store action itself uses for the same
        // refusal, kept in one place).
        const unavailable = figurePublicationSourceUnavailable(document, datasets);
        const sessionBusy = publicationSession !== null;
        const previewDisabled = sessionBusy || unavailable !== null;
        return (
          <div key={document.id} className="qzk-fig-row">
            <input
              type="checkbox"
              aria-label={`Select figure ${document.name} for PDF export`}
              checked={live.includes(document.id)}
              onChange={() => tick(document.id)}
            />
            {live.includes(document.id) && <span className="qzk-fig-meta" title={`PDF page ${live.indexOf(document.id) + 1}`}>{live.indexOf(document.id) + 1}</span>}
            <button
              className="qzk-fig-item"
              title={`open editable figure "${document.name}"`}
              onClick={() => open(document.id)}
            >
              <span className="qzk-fig-name">
                <span
                  className="qzk-ds-icon"
                  aria-hidden="true"
                  title={LIBRARY_NODE_LABEL["editable-figure"]}
                >
                  {LIBRARY_NODE_GLYPH["editable-figure"]}
                </span>
                {document.name}
              </span>
              <span
                className="qzk-fig-meta"
                title={transformProvenance ? `source pipeline: ${transformRecipeLabel(transformProvenance)}` : undefined}
              >
                {dataset?.name ?? "unbound"}
                {transformProvenance ? ` · ${transformProvenance.recipe} r${transformProvenance.revision}` : ""}
              </span>
            </button>
            <button
              className="qz-btn qz-ghost qz-sm"
              style={{ minHeight: 24, minWidth: 24 }}
              aria-label={`Preview "${document.name}" in Publication Preview`}
              title={sessionBusy ? SESSION_BUSY_MSG : (unavailable ?? `open "${document.name}" in Publication Preview; Apply updates it in place`)}
              disabled={previewDisabled}
              onClick={() => previewInPlace(document.id)}
            >
              ⎙
            </button>
            <button
              className="qz-btn qz-ghost qz-sm"
              style={{ minHeight: 24, minWidth: 24 }}
              aria-label="Rename figure"
              title="rename editable figure"
              onClick={() => {
                void runLazy("Loading rename dialog…", () => import("../overlays/ParamDialog")).then(
                  ({ askParams }) =>
                    askParams("Rename editable figure", [
                      { key: "name", label: "Name", type: "text", default: document.name },
                    ], { confirmLabel: "Rename" }).then((params) => {
                      if (params) rename(document.id, String(params.name));
                    }),
                  onLoadFailure,
                );
              }}
            >
              ✎
            </button>
            <button
              className="qz-btn qz-ghost qz-sm"
              style={{ minHeight: 24, minWidth: 24 }}
              aria-label="Duplicate figure"
              title="duplicate editable figure"
              onClick={() => duplicate(document.id)}
            >
              ⧉
            </button>
            <button
              className="qz-btn qz-ghost qz-sm"
              style={{ minHeight: 24, minWidth: 24, marginLeft: 6 }}
              aria-label="Delete figure"
              title="delete editable figure (undo available)"
              onClick={() => {
                // F3.2 referential integrity: a Figure Page panel references
                // this document BY ID ONLY (never a flattened copy), so
                // deleting it never cascades — the panel just resolves to
                // "missing" on its next read (lib/pageDocument.ts's
                // resolvePagePanel, fail-closed). Name the affected page(s)
                // and slot(s) here, before the delete, rather than only
                // discovering the gap later on the page itself.
                const refs = pagesReferencingFigure(pages, document.id);
                const refWarning = refs.length > 0
                  ? ` Also used on ${refs
                      .map((r) => `"${r.page.name}" (panel ${r.labels.join(", ")})`)
                      .join("; ")} — that panel will show as missing.`
                  : "";
                void askConfirm(
                  `Delete "${document.name}"?`,
                  `The saved figure will be removed. You can restore it with Undo.${refWarning}`,
                  "Delete",
                  true,
                ).then((confirmed) => {
                  if (confirmed) remove(document.id);
                });
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
