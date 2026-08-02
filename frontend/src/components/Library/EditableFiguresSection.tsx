// Canonical, reopenable figure documents. Kept separate from Publication
// figures so users can tell an editable plot from an export-preview artifact.
import { useState } from "react";

import { useApp } from "../../store/useApp";
import { askConfirm } from "../overlays/ConfirmDialog";

export default function EditableFiguresSection() {
  const documents = useApp((state) => state.editableFigures);
  const datasets = useApp((state) => state.datasets);
  const open = useApp((state) => state.openEditableFigure);
  const rename = useApp((state) => state.renameEditableFigure);
  const duplicate = useApp((state) => state.duplicateEditableFigure);
  const remove = useApp((state) => state.deleteEditableFigure);
  const [collapsed, setCollapsed] = useState(false);

  if (documents.length === 0) return null;

  return (
    <div className="qzk-lib-group">
      <button className="qzk-group-head" onClick={() => setCollapsed((value) => !value)}>
        <span className="qzk-group-caret">{collapsed ? "▸" : "▾"}</span>
        <span className="qzk-group-name">Editable figures</span>
        <span className="qzk-group-count">{documents.length}</span>
      </button>
      {!collapsed && documents.map((document) => {
        const dataset = datasets.find((candidate) => candidate.id === document.bindings.datasetId);
        return (
          <div key={document.id} style={{ display: "flex", gap: 4, alignItems: "stretch" }}>
            <button
              className="qzk-fig-item"
              title={`open editable figure "${document.name}"`}
              onClick={() => open(document.id)}
            >
              <span className="qzk-fig-name">◇ {document.name}</span>
              <span className="qzk-fig-meta">{dataset?.name ?? "unbound"}</span>
            </button>
            <button
              className="qz-btn qz-ghost qz-sm"
              style={{ minHeight: 24, minWidth: 24 }}
              title="rename editable figure"
              onClick={() => {
                void import("../overlays/ParamDialog").then(({ askParams }) =>
                  askParams("Rename editable figure", [
                    { key: "name", label: "Name", type: "text", default: document.name },
                  ]).then((params) => {
                    if (params) rename(document.id, String(params.name));
                  }),
                );
              }}
            >
              ✎
            </button>
            <button
              className="qz-btn qz-ghost qz-sm"
              style={{ minHeight: 24, minWidth: 24 }}
              title="duplicate editable figure"
              onClick={() => duplicate(document.id)}
            >
              ⧉
            </button>
            <button
              className="qz-btn qz-ghost qz-sm"
              style={{ minHeight: 24, minWidth: 24, marginLeft: 6 }}
              title="delete editable figure (undo available)"
              onClick={() => {
                void askConfirm(
                  `Delete "${document.name}"?`,
                  "The saved figure will be removed. You can restore it with Undo.",
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
