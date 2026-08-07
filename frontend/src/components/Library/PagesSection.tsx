// Library sidebar section (FIGURE_AUTHORING_WORKFLOW_PLAN F3.3): saved
// multi-panel pages. Mirrors EditableFiguresSection.tsx's established
// list/rename/duplicate/delete pattern. Click a row to reopen it in the
// Figure Page workshop (store.openPageDocument seeds the session — see
// components/workshops/figurepage/useFigurePage.ts's pageDocSeed effect).
// Listed most-recently-modified first ("recent access" — F3.3's minimal
// take: a plain sort by the `modifiedAt` timestamp F3.3 added to
// PageDocument, no separate recency index).
//
// F3.6 "export a saved page without reopening it": the ⤓ button resolves the
// SAVED PageDocument directly (`buildPageSpecFromDocument`, the same
// resolve-and-build path a reopened session's canonical panels already go
// through) and exports it, so the common case — a page whose panels are all
// already-saved editable figures — never needs a reopen round trip. A panel
// that can't resolve (a dangling reference, or one that still needs the
// workshop's own unresolved-slot Save gate) fails visibly with the specific
// reason, never a silent partial export.
import { useState } from "react";

import { exportFigurePage } from "../../lib/api";
import { useApp } from "../../store/useApp";
import { toast } from "../../store/toasts";
import { buildPageSpecFromDocument } from "../workshops/figurepage/panelResolve";
import { askConfirm } from "../overlays/ConfirmDialog";
import type { PageDocument } from "../../lib/pageDocument";

async function exportSavedPage(page: PageDocument): Promise<void> {
  const s = useApp.getState();
  try {
    const spec = await buildPageSpecFromDocument(page, s.editableFigures);
    if (!spec) {
      const msg = `"${page.name}" has no assigned panels to export`;
      s.setStatus(msg);
      toast(msg, "danger");
      return;
    }
    await exportFigurePage({ ...spec, fmt: page.output.format, dpi: page.output.dpi });
    s.setStatus(`exported figure_page.${page.output.format}`);
  } catch (e) {
    const msg = `export failed: ${e instanceof Error ? e.message : "error"}`;
    s.setStatus(msg);
    toast(msg, "danger");
  }
}

export default function PagesSection() {
  const pages = useApp((state) => state.pages);
  const open = useApp((state) => state.openPageDocument);
  const rename = useApp((state) => state.renamePageDocument);
  const duplicate = useApp((state) => state.duplicatePageDocument);
  const remove = useApp((state) => state.deletePageDocument);
  const [collapsed, setCollapsed] = useState(false);

  if (pages.length === 0) return null;

  const sorted = [...pages].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

  return (
    <div className="qzk-lib-group">
      <button className="qzk-group-head" onClick={() => setCollapsed((value) => !value)}>
        <span className="qzk-group-caret">{collapsed ? "▸" : "▾"}</span>
        <span className="qzk-group-name">Saved pages</span>
        <span className="qzk-group-count">{pages.length}</span>
      </button>
      {!collapsed && sorted.map((page) => (
        <div key={page.id} style={{ display: "flex", gap: 4, alignItems: "stretch" }}>
          <button
            className="qzk-fig-item"
            title={`open saved page "${page.name}"`}
            onClick={() => open(page.id)}
          >
            <span className="qzk-fig-name">▦ {page.name}</span>
            <span className="qzk-fig-meta">
              {page.rows}×{page.cols}
            </span>
          </button>
          <button
            className="qz-btn qz-ghost qz-sm"
            style={{ minHeight: 24, minWidth: 24 }}
            title="rename saved page"
            onClick={() => {
              void import("../overlays/ParamDialog").then(({ askParams }) =>
                askParams("Rename saved page", [
                  { key: "name", label: "Name", type: "text", default: page.name },
                ]).then((params) => {
                  if (params) rename(page.id, String(params.name));
                }),
              );
            }}
          >
            ✎
          </button>
          <button
            className="qz-btn qz-ghost qz-sm"
            style={{ minHeight: 24, minWidth: 24 }}
            title="duplicate saved page"
            onClick={() => duplicate(page.id)}
          >
            ⧉
          </button>
          <button
            className="qz-btn qz-ghost qz-sm"
            style={{ minHeight: 24, minWidth: 24 }}
            title={`export "${page.name}" without reopening it`}
            onClick={() => void exportSavedPage(page)}
          >
            ⤓
          </button>
          <button
            className="qz-btn qz-ghost qz-sm"
            style={{ minHeight: 24, minWidth: 24, marginLeft: 6 }}
            title="delete saved page (undo available)"
            onClick={() => {
              void askConfirm(
                `Delete "${page.name}"?`,
                "The saved page will be removed. You can restore it with Undo.",
                "Delete",
                true,
              ).then((confirmed) => {
                if (confirmed) remove(page.id);
              });
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
