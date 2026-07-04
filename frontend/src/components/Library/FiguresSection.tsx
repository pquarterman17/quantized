// Library sidebar section (plan item 18): every graph window recovered from
// an imported Origin project, listed as a restorable plot-state snapshot.
// Clicking a resolved entry activates its dataset and applies the figure's
// axis ranges + log flags; an entry whose loose source reference didn't match
// any imported book renders disabled with the reason in its tooltip.

import { useState } from "react";

import { figureLabel } from "../../lib/originFigures";
import { useApp } from "../../store/useApp";

export default function FiguresSection() {
  const figures = useApp((s) => s.originFigures);
  const applyOriginFigure = useApp((s) => s.applyOriginFigure);
  const [collapsed, setCollapsed] = useState(false);

  if (figures.length === 0) return null;

  return (
    <div className="qzk-lib-group">
      <button className="qzk-group-head" onClick={() => setCollapsed((c) => !c)}>
        <span className="qzk-group-caret">{collapsed ? "▸" : "▾"}</span>
        <span className="qzk-group-name">Figures</span>
        <span className="qzk-group-count">{figures.length}</span>
      </button>
      {!collapsed &&
        figures.map((f) => {
          const resolved = f.datasetId != null;
          const title = resolved
            ? `${f.stem} — restore axis ranges (${f.figure.n_curves} curve${f.figure.n_curves === 1 ? "" : "s"})`
            : `unresolved source "${f.figure.source_hint || "unknown"}" — no matching imported book`;
          return (
            <button
              key={f.id}
              className="qzk-fig-item"
              disabled={!resolved}
              title={title}
              onClick={() => applyOriginFigure(f.id)}
            >
              <span className="qzk-fig-name">{figureLabel(f)}</span>
              <span className="qzk-fig-meta">{f.stem}</span>
            </button>
          );
        })}
    </div>
  );
}
