// The Worksheet stage tab (WORKSHEET_PLAN item 3): a thin wrapper feeding a
// dataset id into `WorksheetPane`. All state/behavior lives in
// `components/Stage/worksheet/` — `WorksheetPane` itself has no
// `useActiveDataset`/singleton-view reads, so it stays mountable for any
// dataset (see its doc comment / item 11).
//
// item 15 ("origin book click opens…"): `worksheetId` (set only by
// `useApp.activateFromLibrary`'s worksheet-intent path) overrides `activeId`
// when present — this is what lets opening an Origin book's worksheet leave
// the focused plot window (bound to `activeId`) untouched. null in every
// OTHER case (a plain plot-intent activation always clears it), so this
// falls back to `activeId` — today's behavior, unchanged.

import WorksheetPane from "./worksheet/WorksheetPane";
import { useApp } from "../../store/useApp";

export default function Worksheet() {
  const activeId = useApp((s) => s.activeId);
  const worksheetId = useApp((s) => s.worksheetId);
  const datasetId = worksheetId ?? activeId;
  if (!datasetId) {
    return (
      <div className="qzk-sheet qzk-ds-meta" style={{ padding: 12 }}>
        Select a dataset
      </div>
    );
  }
  return <WorksheetPane datasetId={datasetId} />;
}
