// Library sidebar section (#36): analysis report sheets in the workspace, one
// clickable row per report — click opens it in the viewer ToolWindow. A report
// whose source dataset was removed still opens (it is a computed artifact);
// its meta column just loses the dataset name. Mirrors FiguresSection.

import { useState } from "react";

import { useApp } from "../../store/useApp";

export default function ReportsSection() {
  const reports = useApp((s) => s.reports);
  const datasets = useApp((s) => s.datasets);
  const setOpenReport = useApp((s) => s.setOpenReport);
  const [collapsed, setCollapsed] = useState(false);

  if (reports.length === 0) return null;

  const dsName = (id: string | null): string =>
    (id && datasets.find((d) => d.id === id)?.name) || "";

  return (
    <div className="qzk-lib-group">
      <button className="qzk-group-head" onClick={() => setCollapsed((c) => !c)}>
        <span className="qzk-group-caret">{collapsed ? "▸" : "▾"}</span>
        <span className="qzk-group-name">Reports</span>
        <span className="qzk-group-count">{reports.length}</span>
      </button>
      {!collapsed &&
        reports.map((r) => (
          <button
            key={r.id}
            className="qzk-fig-item"
            title={`open report "${r.name}"`}
            onClick={() => setOpenReport(r.id)}
          >
            <span className="qzk-fig-name">▤ {r.name}</span>
            <span className="qzk-fig-meta">{dsName(r.datasetId)}</span>
          </button>
        ))}
    </div>
  );
}
