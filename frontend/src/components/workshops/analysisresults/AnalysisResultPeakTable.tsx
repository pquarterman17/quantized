import type { PeakTable, PeakTableEntry } from "../../../lib/peakTable";
import { Button } from "../../primitives";

function value(number: number | null | undefined): string {
  if (number === null || number === undefined || !Number.isFinite(number)) return "—";
  const magnitude = Math.abs(number);
  return magnitude !== 0 && (magnitude >= 1e5 || magnitude < 1e-4)
    ? number.toExponential(5)
    : number.toLocaleString(undefined, { maximumSignificantDigits: 7 });
}

function estimate(row: PeakTableEntry, field: "center" | "fwhm" | "height" | "area"): string {
  const uncertainty = field === "area" ? row.areaErr : row[`${field}Err`];
  return `${value(row[field])}${uncertainty == null ? "" : ` ± ${value(uncertainty)}`}`;
}

export default function AnalysisResultPeakTable({ table, onExport }: {
  table: PeakTable | null;
  onExport: () => void;
}) {
  if (!table) return <p className="qz-analysis-empty">The source worksheet no longer has a fitted peak table.</p>;
  const rows = table.peaks.slice(0, 100);
  return <div className="qz-analysis-table-view">
    <div className="qz-analysis-subtoolbar">
      <span className="qz-analysis-caption">{table.peaks.length.toLocaleString()} fitted peak{table.peaks.length === 1 ? "" : "s"}</span>
      <Button size="sm" onClick={onExport}>Export CSV</Button>
    </div>
    <div className="qz-analysis-table-wrap">
      <table className="qz-analysis-table">
        <thead><tr>
          <th>#</th><th>Included</th><th>Center ± 1σ</th><th>FWHM ± 1σ</th>
          <th>Height ± 1σ</th><th>Area ± 1σ</th><th>Model</th><th>Status</th>
        </tr></thead>
        <tbody>{rows.map((peak, index) => <tr key={peak.id} className={peak.excluded ? "excluded" : ""}>
          <td>{index + 1}</td><td>{peak.excluded ? "No" : "Yes"}</td>
          <td>{estimate(peak, "center")}</td><td>{estimate(peak, "fwhm")}</td>
          <td>{estimate(peak, "height")}</td><td>{estimate(peak, "area")}</td>
          <td>{peak.model}</td><td>{peak.status}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {table.peaks.length > rows.length && <p className="qz-analysis-caption">Showing the first {rows.length} peaks. Export CSV includes every row.</p>}
  </div>;
}
