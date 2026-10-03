import type { BatchFigureRow } from "../../../store/batchFigureBuild";
import { Badge } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { STATUS_LABEL, STATUS_TONE } from "./batchFigureBuilderOptions";

interface Props {
  rows: readonly BatchFigureRow[];
  includedIds: ReadonlySet<string>;
  busy: boolean;
  done: boolean;
  onToggle: (datasetId: string, included: boolean) => void;
}

export default function BatchCompatibilityReview({ rows, includedIds, busy, done, onToggle }: Props) {
  return (
    <>
      <div className="qzk-win-section">Compatibility review</div>
      <div style={{ maxHeight: 230, overflow: "auto" }}>
        <table className="qz-table" aria-label="Batch figure compatibility">
          <thead><tr><th>Build</th><th>Dataset</th><th>Status</th><th>Details</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.datasetId}>
                <td>
                  <Checkbox
                    aria-label={`Build ${row.datasetName}`}
                    checked={includedIds.has(row.datasetId)}
                    disabled={busy || done || row.status === "blocked"}
                    onChange={(included) => onToggle(row.datasetId, included)}
                  />
                </td>
                <td>{row.datasetName}</td>
                <td><Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge></td>
                <td>
                  <div>{row.summary}</div>
                  {row.status === "partial" && !includedIds.has(row.datasetId) && <div className="qzk-ds-meta">Check Build to explicitly accept a partial figure.</div>}
                  {row.unmatched.length > 0 && <div className="qzk-ds-meta" title={row.unmatched.join("; ")}>Missing: {row.unmatched.join("; ")}</div>}
                  {row.warnings.length > 0 && <div className="qzk-ds-meta" title={row.warnings.join("; ")}>Warnings: {row.warnings.join("; ")}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
