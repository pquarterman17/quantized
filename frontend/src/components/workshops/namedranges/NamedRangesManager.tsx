// The Named Ranges manager (ROW_RANGE_CONTRACT 5.5, slice R4c): every range of the project with its worksheet, columns,
// rows, scope, stale flag and how many things use it, and rename / retarget / delete (with the dependants dialog) on each.
// Opened from the Name box, the Data menu and the command palette (./openManager.tsx).

import { useMemo } from "react";

import { useApp } from "../../../store/useApp";
import { namedRangeDependants } from "../../../store/namedRanges";
import ToolWindowFrame from "../../overlays/ToolWindowFrame";
import type { SelectedBlock } from "./nameBoxModel";
import NamedRangeRow from "./NamedRangeRow";
import "./namedRanges.css";

interface Props {
  onClose: () => void;
  selection?: { datasetId: string; block: SelectedBlock };
}

export default function NamedRangesManager({ onClose, selection }: Props) {
  const ranges = useApp((s) => s.namedRanges);
  const datasets = useApp((s) => s.datasets);
  const workbooks = useApp((s) => s.workbooks);
  // "Used by" is recomputed whenever a range or a worksheet (where the formulas live) changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const counts = useMemo(() => new Map(ranges.map((r) => [r.id, namedRangeDependants(r.id).length])), [ranges, datasets]);
  const workbookName = (id: string) => workbooks.find((w) => w.id === id)?.name ?? "(deleted)";
  return (
    <ToolWindowFrame id="named-ranges" title="Named ranges" width={760} onClose={onClose}>
      {ranges.length === 0 ? (
        <p className="qzk-ds-meta">
          No named ranges yet. Select cells in a worksheet and type a name in the Name box, then use it as <code>mean(rng("Name"))</code> in a
          formula, or plot or analyze it from here.
        </p>
      ) : (
        <table className="qzk-nr-table" aria-label="Named ranges">
          <thead>
            <tr>
              <th>Name</th>
              <th>Scope</th>
              <th>Covers</th>
              <th>Status</th>
              <th>Used by</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {ranges.map((range) => (
              <NamedRangeRow key={range.id} range={range} datasets={datasets} workbookName={workbookName} usedBy={counts.get(range.id) ?? 0} selection={selection} />
            ))}
          </tbody>
        </table>
      )}
    </ToolWindowFrame>
  );
}
