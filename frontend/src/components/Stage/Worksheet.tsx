// The Worksheet stage tab (WORKSHEET_PLAN item 3): a thin wrapper feeding the
// globally-active dataset id into `WorksheetPane`. All state/behavior lives in
// `components/Stage/worksheet/` — `WorksheetPane` itself has no
// `useActiveDataset`/singleton-view reads, so it stays mountable for any
// dataset (see its doc comment / item 11).

import WorksheetPane from "./worksheet/WorksheetPane";
import { useApp } from "../../store/useApp";

export default function Worksheet() {
  const activeId = useApp((s) => s.activeId);
  if (!activeId) {
    return (
      <div className="qzk-sheet qzk-ds-meta" style={{ padding: 12 }}>
        Select a dataset
      </div>
    );
  }
  return <WorksheetPane datasetId={activeId} />;
}
