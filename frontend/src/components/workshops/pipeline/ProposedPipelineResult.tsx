import type { PipelineEditPreview as Preview } from "./pipelineEditPreview";

interface Props {
  preview: Preview | null;
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  return magnitude >= 1e5 || magnitude < 1e-4
    ? value.toExponential(4)
    : Number(value.toPrecision(6)).toLocaleString();
}

export default function PipelineEditPreview({ preview }: Props) {
  if (!preview) {
    return (
      <section className="qzk-pipeline-preview qzk-pipeline-preview-loading" aria-label="Proposed pipeline result" aria-busy="true">
        Computing a bounded preview…
      </section>
    );
  }

  const output = preview.output;
  const statusLabel = {
    ready: "Preview ready",
    partial: "Partial preview",
    blocked: "Edit blocked",
    unavailable: "Preview unavailable",
  }[preview.status];

  return (
    <section
      className={`qzk-pipeline-preview qzk-pipeline-preview-${preview.status}`}
      aria-label="Proposed pipeline result"
      aria-live="polite"
    >
      <div className="qzk-pipeline-preview-head">
        <strong>{statusLabel}</strong>
        {preview.input && output && (
          <span>
            {preview.input.columns.toLocaleString()} → {output.columns.toLocaleString()} columns
            {preview.capped ? ` · first ${output.rows.toLocaleString()} rows sampled` : ` · ${output.rows.toLocaleString()} rows`}
          </span>
        )}
      </div>
      {preview.status === "blocked" && output && <div>Last verified table before the blocked step:</div>}
      {output && (
        <div className="qzk-pipeline-preview-table-wrap">
          <table className="qzk-pipeline-preview-table">
            <thead>
              <tr>
                <th scope="col">X</th>
                {output.labels.map((label, index) => (
                  <th scope="col" key={`${label}-${index}`}>
                    {label || `Column ${index + 1}`}
                    {output.units[index] ? <small>{output.units[index]}</small> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {output.sample.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((value, columnIndex) => <td key={columnIndex}>{formatValue(value)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {preview.warnings.length > 0 && (
        <ul className="qzk-pipeline-preview-warnings">
          {preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
      {preview.status === "partial" && <div>Later steps are not represented in the table above.</div>}
      {preview.status === "blocked" && <div role="alert">Fix this incompatibility before committing the edit.</div>}
      {preview.status === "unavailable" && <div>The edit remains undoable, but its numeric result could not be verified here.</div>}
    </section>
  );
}
