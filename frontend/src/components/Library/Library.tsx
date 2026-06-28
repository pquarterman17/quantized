// Left panel: dataset list with sparklines. Import via the file picker or by
// dragging files onto the panel; click a row to activate, ✕ to remove.

import { useState } from "react";

import Sparkline from "./Sparkline";
import { Badge } from "../primitives";
import { makeDemoDataset } from "../../lib/demo";
import { openFilePicker } from "../../lib/openFilePicker";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

let demoSeq = 0;
const ACCEPT = ".dat,.csv,.txt,.xrdml,.raw,.refl,.pnr,.datA,.cif,.xlsx,.xls";

export default function Library() {
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);
  const setActive = useApp((s) => s.setActive);
  const addDataset = useApp((s) => s.addDataset);
  const removeDataset = useApp((s) => s.removeDataset);
  const duplicateDataset = useApp((s) => s.duplicateDataset);
  const moveDataset = useApp((s) => s.moveDataset);
  const renameDataset = useApp((s) => s.renameDataset);
  const addDatasetTag = useApp((s) => s.addDatasetTag);
  const removeDatasetTag = useApp((s) => s.removeDatasetTag);
  const importFiles = useApp((s) => s.importFiles);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [tagging, setTagging] = useState<{ id: string; value: string } | null>(null);

  const commitRename = () => {
    if (editing) renameDataset(editing.id, editing.value);
    setEditing(null);
  };

  const commitTag = () => {
    if (tagging && tagging.value.trim()) addDatasetTag(tagging.id, tagging.value);
    setTagging(null);
  };

  const onImport = () => openFilePicker((files) => void importFiles(files), ACCEPT);

  const onDemo = () => {
    const ds: Dataset = {
      id: `demo-${++demoSeq}`,
      name: `demo-vsm-${demoSeq}.dat`,
      data: makeDemoDataset(),
    };
    addDataset(ds);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) void importFiles(files);
  };

  // Filter matches the dataset name OR any of its tags (so typing a tag — or
  // clicking a tag chip, which sets the query — narrows the library to it).
  const q = query.toLowerCase();
  const shown = datasets.filter(
    (d) =>
      d.name.toLowerCase().includes(q) ||
      (d.tags ?? []).some((t) => t.toLowerCase().includes(q)),
  );
  // Reorder only on the full list — swapping adjacent rows while a filter hides
  // neighbors would be confusing, so the ▲▼ buttons hide when a query is active.
  const canReorder = query.trim() === "";

  return (
    <aside
      className={`qzk-library${dragging ? " dragover" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <div className="qzk-lib-head">
        <span className="qzk-lib-title">Library</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="qz-icon-btn" title="Add demo dataset" onClick={onDemo}>
            ✚
          </button>
          <button className="qz-icon-btn" title="Import data…" onClick={onImport}>
            ⊞
          </button>
        </div>
      </div>

      <input
        className="qz-input"
        placeholder="⌕ Filter…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {shown.map((d) => (
        <div
          key={d.id}
          className={`qzk-ds${d.id === activeId ? " active" : ""}`}
          onClick={() => setActive(d.id)}
        >
          <div className="qzk-ds-top">
            {editing?.id === d.id ? (
              <input
                className="qz-input qzk-ds-name"
                autoFocus
                value={editing.value}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setEditing({ id: d.id, value: e.target.value })}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setEditing(null);
                }}
              />
            ) : (
              <span
                className="qzk-ds-name"
                title={`${d.name} — double-click to rename`}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditing({ id: d.id, value: d.name });
                }}
              >
                {d.name}
              </span>
            )}
          </div>
          <Sparkline data={d.data} />
          <div className="qzk-ds-foot">
            <span className="qzk-ds-meta">
              {d.data.time.length} pts · {d.data.units[0] || "—"}
            </span>
            <span className="qzk-ds-actions">
              <Badge tone="accent">{d.data.labels.length}ch</Badge>
              {canReorder && (
                <>
                  <button
                    className="qz-icon-btn"
                    title="Move up"
                    disabled={datasets.indexOf(d) === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveDataset(d.id, -1);
                    }}
                  >
                    ▲
                  </button>
                  <button
                    className="qz-icon-btn"
                    title="Move down"
                    disabled={datasets.indexOf(d) === datasets.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveDataset(d.id, 1);
                    }}
                  >
                    ▼
                  </button>
                </>
              )}
              <button
                className="qz-icon-btn"
                title="Duplicate"
                onClick={(e) => {
                  e.stopPropagation();
                  duplicateDataset(d.id);
                }}
              >
                ⧉
              </button>
              <button
                className="qz-icon-btn"
                title="Remove"
                onClick={(e) => {
                  e.stopPropagation();
                  removeDataset(d.id);
                }}
              >
                ✕
              </button>
            </span>
          </div>
          <div className="qzk-ds-tags">
            {(d.tags ?? []).map((t) => (
              <span
                key={t}
                className="qzk-tag"
                title={`Filter by "${t}"`}
                onClick={(e) => {
                  e.stopPropagation();
                  setQuery(t);
                }}
              >
                {t}
                <button
                  className="qzk-tag-x"
                  title="Remove tag"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeDatasetTag(d.id, t);
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            {tagging?.id === d.id ? (
              <input
                className="qz-input qzk-tag-input"
                autoFocus
                placeholder="tag…"
                value={tagging.value}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setTagging({ id: d.id, value: e.target.value })}
                onBlur={commitTag}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTag();
                  if (e.key === "Escape") setTagging(null);
                }}
              />
            ) : (
              <button
                className="qzk-tag qzk-tag-add"
                title="Add tag"
                onClick={(e) => {
                  e.stopPropagation();
                  setTagging({ id: d.id, value: "" });
                }}
              >
                ＋
              </button>
            )}
          </div>
        </div>
      ))}

      {shown.length === 0 && (
        <div className="qzk-ds-meta" style={{ padding: 8, textAlign: "center" }}>
          {datasets.length === 0
            ? "Drop files here, or use ⊞ to import / ✚ for a demo"
            : "No matches"}
        </div>
      )}
    </aside>
  );
}
