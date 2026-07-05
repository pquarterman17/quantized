// Library sidebar section (plan item 18): every graph window recovered from an
// imported Origin project, listed as a restorable plot-state snapshot. Shown as
// a flat collapsible section only when the library has NO folders — once folders
// exist the figures nest inside the tree under their project folder (see
// Library.tsx / useLibraryTree), so this section is hidden to avoid duplication.

import { useState } from "react";

import FigureRow from "./FigureRow";
import { useApp } from "../../store/useApp";

export default function FiguresSection() {
  const figures = useApp((s) => s.originFigures);
  const [collapsed, setCollapsed] = useState(false);

  if (figures.length === 0) return null;

  return (
    <div className="qzk-lib-group">
      <button className="qzk-group-head" onClick={() => setCollapsed((c) => !c)}>
        <span className="qzk-group-caret">{collapsed ? "▸" : "▾"}</span>
        <span className="qzk-group-name">Figures</span>
        <span className="qzk-group-count">{figures.length}</span>
      </button>
      {!collapsed && figures.map((f) => <FigureRow key={f.id} entry={f} />)}
    </div>
  );
}
