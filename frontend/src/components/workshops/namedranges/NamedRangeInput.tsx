// "Input from a named range" for the analysis input picker (ROW_RANGE_CONTRACT 5.2): choose a named range and the
// tool's input becomes its columns and its rows, through the shared analysis selection (the same `rowRange` the row
// range fields set), not a parallel path. A range that cannot be read now (stale, broken) is listed but disabled with
// the reason.

import { describeNamedRange, namedRangeIssue } from "../../../lib/namedRanges";
import { useApp } from "../../../store/useApp";
import { analysisInputFromNamedRange } from "../../../store/namedRangeUse";

export default function NamedRangeInput({ toolId }: { toolId: string }) {
  const ranges = useApp((s) => s.namedRanges);
  const datasets = useApp((s) => s.datasets);
  if (ranges.length === 0) return null;
  return (
    <label className="qzk-analysis-input-named">
      From named range
      <select
        className="qz-select"
        aria-label="Input from named range"
        value=""
        onChange={(e) => {
          if (e.target.value) analysisInputFromNamedRange(e.target.value, toolId);
        }}
      >
        <option value="">Choose…</option>
        {ranges.map((r) => {
          const issue = namedRangeIssue(r, datasets);
          return (
            <option key={r.id} value={r.id} disabled={issue !== null} title={issue ?? undefined}>
              {r.name} — {describeNamedRange(r, datasets)}
              {issue ? ` (${r.rowsStale ? "stale" : "unavailable"})` : ""}
            </option>
          );
        })}
      </select>
    </label>
  );
}
