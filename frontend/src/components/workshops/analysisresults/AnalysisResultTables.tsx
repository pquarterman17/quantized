import { useEffect, useMemo, useState } from "react";

import type { AnalysisResult } from "../../../lib/analysisResult";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { Button } from "../../primitives";

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return "";
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude >= 1e5 || magnitude < 1e-4)) return value.toExponential(6);
  return value.toLocaleString(undefined, { maximumSignificantDigits: 8 });
}

function refsFor(result: AnalysisResult): { datasetId: string; label: string }[] {
  const refs = result.tableRefs?.length
    ? result.tableRefs
    : result.outputs.map((output) => ({ datasetId: output.datasetId, label: "Output table" }));
  return refs.filter((ref, index) => refs.findIndex((item) => item.datasetId === ref.datasetId) === index);
}

function Preview({ output }: { output: Dataset }) {
  const rows = Math.min(output.data.time.length, 100);
  return <>
    <div className="qz-analysis-table-wrap">
      <table className="qz-analysis-table">
        <thead><tr>
          <th>{String(output.data.metadata.xLabel ?? "X")}</th>
          {output.data.labels.map((label, index) => <th key={`${label}-${index}`}>{label}</th>)}
        </tr></thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => <tr key={row}>
            <td>{formatValue(output.data.time[row])}</td>
            {output.data.labels.map((_, column) => <td key={column}>{formatValue(output.data.values[row]?.[column] ?? NaN)}</td>)}
          </tr>)}
        </tbody>
      </table>
    </div>
    {output.data.time.length > rows && <p className="qz-analysis-caption">Showing the first {rows.toLocaleString()} of {output.data.time.length.toLocaleString()} rows. Export CSV includes every row.</p>}
  </>;
}

export default function AnalysisResultTables({ result, onOpen, onExport }: {
  result: AnalysisResult;
  onOpen: (datasetId: string) => void;
  onExport: (datasetId: string) => void;
}) {
  const datasets = useApp((state) => state.datasets);
  const refs = useMemo(() => refsFor(result), [result]);
  const [selectedId, setSelectedId] = useState(refs[0]?.datasetId ?? "");
  useEffect(() => {
    if (!refs.some((ref) => ref.datasetId === selectedId)) setSelectedId(refs[0]?.datasetId ?? "");
  }, [refs, selectedId]);
  const selected = refs.find((ref) => ref.datasetId === selectedId) ?? refs[0];
  const output = datasets.find((dataset) => dataset.id === selected?.datasetId);

  if (!selected) return <p className="qz-analysis-empty">No output tables were recorded for this result.</p>;
  return <div className="qz-analysis-table-view">
    <div className="qz-analysis-subtoolbar">
      {refs.length > 1 && <label>Table <select value={selected.datasetId} onChange={(event) => setSelectedId(event.target.value)}>
        {refs.map((ref) => <option key={ref.datasetId} value={ref.datasetId}>{ref.label}</option>)}
      </select></label>}
      <Button size="sm" disabled={!output} onClick={() => output && onOpen(output.id)}>Open worksheet</Button>
      <Button size="sm" disabled={!output} onClick={() => onExport(selected.datasetId)}>Export CSV</Button>
    </div>
    {output ? <Preview output={output} /> : <p className="qz-analysis-empty">The table worksheet “{selected.label}” is unavailable.</p>}
  </div>;
}
