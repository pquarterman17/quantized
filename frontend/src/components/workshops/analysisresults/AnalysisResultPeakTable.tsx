import { fmtValueErr } from "../../../lib/fitValueFormat";
import { peakFitStatus } from "../../../lib/peakFitStatus";
import type { PeakTable, PeakTableEntry } from "../../../lib/peakTable";
import { Button } from "../../primitives";
import { fmtInt } from "../../../lib/locale";

type Field = "center" | "fwhm" | "height" | "area";
const FIELDS: readonly [Field, string][] = [["center", "Center"], ["fwhm", "FWHM"], ["height", "Height"], ["area", "Area"]];

function value(number: number | null | undefined): string {
  if (number === null || number === undefined || !Number.isFinite(number)) return "—";
  const magnitude = Math.abs(number);
  return magnitude !== 0 && (magnitude >= 1e5 || magnitude < 1e-4)
    ? number.toExponential(5)
    : number.toLocaleString(undefined, { maximumSignificantDigits: 7 });
}

const errOf = (row: PeakTableEntry, field: Field): number | null | undefined =>
  field === "area" ? row.areaErr : row[`${field}Err`];
const usable = (e: number | null | undefined): e is number => typeof e === "number" && Number.isFinite(e) && e > 0;

/** The value and its 1σ, both PDG-rounded (Curve Fit's rule), or the bare value. */
function estimate(row: PeakTableEntry, field: Field): string {
  const e = errOf(row, field);
  return usable(e) && Number.isFinite(row[field]) ? fmtValueErr(row[field], e) : value(row[field]);
}

export default function AnalysisResultPeakTable({ table, onExport }: {
  table: PeakTable | null;
  onExport: () => void;
}) {
  if (!table) return <p className="qz-analysis-empty">The source worksheet no longer has a fitted peak table.</p>;
  const rows = table.peaks.slice(0, 100);
  // A "± 1σ" header only over a column that has at least one σ (UX audit 9 #3:
  // every header promised one while no producer filled it).
  const hasErr = (field: Field) => table.peaks.some((row) => usable(errOf(row, field)));
  return <div className="qz-analysis-table-view">
    <div className="qz-analysis-subtoolbar">
      <span className="qz-analysis-caption">{fmtInt(table.peaks.length)} fitted peak{table.peaks.length === 1 ? "" : "s"}</span>
      <Button size="sm" onClick={onExport}>Export CSV</Button>
    </div>
    <div className="qz-analysis-table-wrap">
      <table className="qz-analysis-table">
        <thead><tr>
          <th>#</th><th>Included</th>
          {FIELDS.map(([field, label]) => <th key={field}>{hasErr(field) ? `${label} ± 1σ` : label}</th>)}
          <th>Model</th><th>Status</th>
        </tr></thead>
        <tbody>{rows.map((peak, index) => <tr key={peak.id} className={peak.excluded ? "excluded" : ""}>
          <td>{index + 1}</td><td>{peak.excluded ? "No" : "Yes"}</td>
          {FIELDS.map(([field]) => <td key={field}>{estimate(peak, field)}</td>)}
          <td>{peak.model}</td><td>{peak.status}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {table.peaks.length > rows.length && <p className="qz-analysis-caption">Showing the first {rows.length} peaks. Export CSV includes every row.</p>}
  </div>;
}

/** The overview's "Fit quality" row: a polished simultaneous fit's verdict
 *  (lib/peakFitStatus), warn-toned beside the freshness badge, which says only
 *  whether the table still matches its data — not whether the fit is good. */
export function PeakFitQuality({ table }: { table: PeakTable | null }) {
  const prov = table?.provenance;
  if (!prov?.solver || prov.method !== "simultaneous") return null;
  const status = peakFitStatus(prov);
  return <div data-fit-status={status.tone}><dt>Fit quality</dt><dd style={status.tone === "warn" ? { color: "var(--warn)" } : undefined}>
    {status.tone === "warn" ? status.text : `Converged${status.text ? ` · ${status.text}` : ""}`}
  </dd></div>;
}
