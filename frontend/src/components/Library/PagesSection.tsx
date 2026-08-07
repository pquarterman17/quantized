// Library sidebar section (FIGURE_AUTHORING_WORKFLOW_PLAN F3.3): saved
// multi-panel pages. Mirrors EditableFiguresSection.tsx's established
// list/rename/duplicate/delete pattern. Click a row to reopen it in the
// Figure Page workshop (store.openPageDocument seeds the session — see
// components/workshops/figurepage/useFigurePage.ts's pageDocSeed effect).
// Listed most-recently-modified first ("recent access" — F3.3's minimal
// take: a plain sort by the `modifiedAt` timestamp F3.3 added to
// PageDocument, no separate recency index).
import { useState } from "react";

import { useApp } from "../../store/useApp";
import { askConfirm } from "../overlays/ConfirmDialog";

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
