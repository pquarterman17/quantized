// Left panel: dataset list with sparklines + import. Click a row to activate.

import { useState } from "react";

import Sparkline from "./Sparkline";
import { Badge } from "../primitives";
import { importFile } from "../../lib/api";
import { makeDemoDataset } from "../../lib/demo";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

let counter = 0;
const nextId = () => `ds-${++counter}`;

export default function Library() {
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);
  const setActive = useApp((s) => s.setActive);
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const [query, setQuery] = useState("");

  async function onImport() {
    const path = window.prompt("Import data — local file path:");
    if (!path) return;
    try {
      setStatus(`importing ${path}…`);
      const data = await importFile(path);
      const name = path.split(/[\\/]/).pop() ?? path;
      addDataset({ id: nextId(), name, data });
      setStatus("backend ready");
    } catch (err) {
      setStatus(`import failed: ${(err as Error).message}`);
    }
  }

  function onDemo() {
    const ds: Dataset = { id: nextId(), name: "demo-vsm.dat", data: makeDemoDataset() };
    addDataset(ds);
  }

  const shown = datasets.filter((d) =>
    d.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <aside className="qzk-library">
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
            <Badge tone="accent">{d.data.labels.length}ch</Badge>
          </div>
          <Sparkline data={d.data} />
          <div className="qzk-ds-meta">
            {d.data.time.length} pts · {d.data.units[0] || "—"}
          </div>
        </div>
      ))}

      {shown.length === 0 && (
        <div className="qzk-ds-meta" style={{ padding: 8, textAlign: "center" }}>
          {datasets.length === 0 ? "No datasets — import or add demo" : "No matches"}
        </div>
      )}
    </aside>
  );
}
