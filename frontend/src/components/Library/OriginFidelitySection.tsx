import { useState } from "react";

import {
  originFidelityLabel,
  originFidelityStatusLabel,
} from "../../lib/originFidelity";
import { useApp } from "../../store/useApp";

export default function OriginFidelitySection() {
  const entries = useApp((s) => s.originFidelity);
  const [collapsed, setCollapsed] = useState(false);
  if (entries.length === 0) return null;

  return (
    <div className="qzk-lib-group" aria-label="Origin import fidelity">
      <button className="qzk-group-head" onClick={() => setCollapsed((c) => !c)}>
        <span className="qzk-group-caret">{collapsed ? "▸" : "▾"}</span>
        <span className="qzk-group-name">Origin fidelity</span>
        <span className="qzk-group-count">{entries.length}</span>
      </button>
      {!collapsed &&
        entries.map((entry) => {
          const m = entry.manifest;
          return (
            <details className="qzk-fig-item" key={entry.id} style={{ display: "block" }}>
              <summary className="qzk-fig-name">
                {entry.stem} · {originFidelityStatusLabel(m.status)}
              </summary>
              <div className="qzk-ds-meta">
                {m.graph_records_actionable}/{m.graph_records_total} graph records editable
                {m.graph_records_filtered > 0 ? ` · ${m.graph_records_filtered} internal filtered` : ""}
              </div>
              <div className="qzk-ds-meta">
                Missing: {m.omissions.map(originFidelityLabel).join(", ")}
              </div>
              {m.filtered_figures.length > 0 && (
                <div className="qzk-ds-meta">
                  Filtered: {m.filtered_figures.map((f) => f.name).join(", ")}
                </div>
              )}
            </details>
          );
        })}
    </div>
  );
}
