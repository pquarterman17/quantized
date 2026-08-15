// Library sidebar section (plan item 18): every graph window recovered from an
// imported Origin project, listed as a restorable plot-state snapshot. Shown
// as a flat collapsible section only while the tree ISN'T rendering (search
// mode, or an empty library) — once the tree renders (LIBRARY_WORKBOOK_UX_PLAN
// PR C: whenever the Library is non-empty and there's no search query) each
// figure nests inside it via LibraryTree.tsx/FigureRow.tsx, so this section is
// hidden to avoid duplication.

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
