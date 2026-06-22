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
  const importFiles = useApp((s) => s.importFiles);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);

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

  const shown = datasets.filter((d) =>
    d.name.toLowerCase().includes(query.toLowerCase()),
  );

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
            <span className="qzk-ds-name" title={d.name}>
              {d.name}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Badge tone="accent">{d.data.labels.length}ch</Badge>
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
          <Sparkline data={d.data} />
          <div className="qzk-ds-meta">
            {d.data.time.length} pts · {d.data.units[0] || "—"}
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
