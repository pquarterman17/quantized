import { useEffect, useMemo, useState } from "react";

import { listFitModels } from "../../../lib/api/curvefit";
import { fitParameterRows } from "../../../lib/analysisFitTable";
import type { FitSpec } from "../../../lib/types";
import { Button } from "../../primitives";

function value(number: number | null): string {
  if (number === null || !Number.isFinite(number)) return "—";
  const magnitude = Math.abs(number);
  return magnitude !== 0 && (magnitude >= 1e5 || magnitude < 1e-4)
    ? number.toExponential(6)
    : number.toLocaleString(undefined, { maximumSignificantDigits: 8 });
}

export default function AnalysisResultFitTable({ spec, onExport }: {
  spec: FitSpec | null;
  onExport: () => void;
}) {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    setNames([]);
    if (!spec) return () => { cancelled = true; };
    void listFitModels().then(({ models }) => {
      if (!cancelled) setNames(models.find((model) => model.name === spec.model)?.paramNames ?? []);
    }, () => undefined);
    return () => { cancelled = true; };
  }, [spec]);
  const rows = useMemo(() => spec ? fitParameterRows(spec, names) : [], [names, spec]);
  if (!spec) return <p className="qz-analysis-empty">The source worksheet no longer has a saved curve fit.</p>;
  if (!rows.length) return <p className="qz-analysis-empty">This legacy fit records its model but no fitted parameters.</p>;
  return <div className="qz-analysis-table-view">
    <div className="qz-analysis-subtoolbar">
      <span className="qz-analysis-caption">{rows.length} fitted parameter{rows.length === 1 ? "" : "s"}</span>
      <Button size="sm" onClick={onExport}>Export CSV</Button>
    </div>
    <div className="qz-analysis-table-wrap">
      <table className="qz-analysis-table">
        <thead><tr><th>Parameter</th><th>Value</th><th>± 1σ</th><th>State</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={`${row.name}-${index}`}>
          <td>{row.name}</td><td>{value(row.value)}</td><td>{value(row.error)}</td>
          <td>{row.fixed ? "Held" : "Fitted"}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
