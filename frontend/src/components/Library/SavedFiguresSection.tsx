// Library sidebar section (#12): user-authored figure documents. Click a row
// to re-open it in the figure builder (live docs activate their dataset and
// render CURRENT data; frozen docs render their stored snapshot). A live doc
// whose dataset was removed renders disabled. Mirrors FiguresSection (the
// Origin-import figures) and ReportsSection.

import { useState } from "react";

import { docRenderable } from "../../lib/figuredoc";
import { useApp } from "../../store/useApp";

export default function SavedFiguresSection() {
  const docs = useApp((s) => s.figureDocs);
  const openFigureDoc = useApp((s) => s.openFigureDoc);
  const duplicateFigureDoc = useApp((s) => s.duplicateFigureDoc);
  const removeFigureDoc = useApp((s) => s.removeFigureDoc);
  const [collapsed, setCollapsed] = useState(false);

  if (docs.length === 0) return null;

  return (
    <div className="qzk-lib-group">
      <button className="qzk-group-head" onClick={() => setCollapsed((c) => !c)}>
        <span className="qzk-group-caret">{collapsed ? "▸" : "▾"}</span>
        <span className="qzk-group-name">Saved figures</span>
        <span className="qzk-group-count">{docs.length}</span>
      </button>
      {!collapsed &&
        docs.map((d) => {
          const ok = docRenderable(d);
          return (
            <div key={d.id} style={{ display: "flex", gap: 4, alignItems: "stretch" }}>
              <button
                className="qzk-fig-item"
                disabled={!ok}
                title={
                  ok
                    ? `open figure "${d.name}"${d.live ? "" : " (frozen data)"}`
                    : "source dataset was removed"
                }
                onClick={() => openFigureDoc(d.id)}
              >
                <span className="qzk-fig-name">
                  {d.live ? "◉" : "❄"} {d.name}
                </span>
                <span className="qzk-fig-meta">{d.config.style}</span>
              </button>
              <button
                className="qz-btn qz-ghost qz-sm"
                title="duplicate figure"
                onClick={() => duplicateFigureDoc(d.id)}
              >
                ⧉
              </button>
              <button
                className="qz-btn qz-ghost qz-sm"
                title="delete figure"
                onClick={() => removeFigureDoc(d.id)}
              >
                ×
              </button>
            </div>
          );
        })}
    </div>
  );
}
