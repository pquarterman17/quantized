import type { AnalysisResult, AnalysisResultValue } from "../../../lib/analysisResult";
import { snapshotResultSourceless } from "../../../lib/analysisResultFreshness";
import { fmtNum } from "../../../lib/format";
import { statisticalResultTableSelections } from "../../../lib/statisticalResultSelection";
import type { Dataset } from "../../../lib/types";
import { Button } from "../../primitives";
import { DataTable } from "../../primitives/DataTable";
import StatisticalReportingCard from "./StatisticalReportingCard";

function date(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString();
}

function display(value: AnalysisResultValue): string {
  if (typeof value === "number") return fmtNum(value);
  if (typeof value === "string") return value;
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return JSON.stringify(value);
}

export default function AnalysisResultSnapshot({
  result, source, view, onExport, onCopy, onSelectRows, selectionEnabled = false, disabled = false,
}: {
  result: AnalysisResult;
  source: Dataset | undefined;
  view: "overview" | "table" | "provenance";
  onExport: (tableIndex?: number) => void;
  onCopy?: (tableIndex?: number) => void;
  onSelectRows?: (rows: number[]) => void;
  selectionEnabled?: boolean;
  disabled?: boolean;
}) {
  const interpretation = result.scalarValues?.Interpretation;
  const scientificValues = result.producer.id === "williamson-hall"
    ? Object.entries(result.scalarValues ?? {}).filter(([key]) => !["Analysis", "Test", "Interpretation"].includes(key))
    : [];
  if (view === "overview") return <>
    <dl className="qz-analysis-summary">
      <div><dt>Analysis</dt><dd>{String(result.scalarValues?.Test ?? result.producer.label)}</dd></div>
      <div><dt>Source</dt><dd>{source?.name ?? (snapshotResultSourceless(result) && !result.sources.length ? "No worksheet required" : "Missing source")}</dd></div>
      <div><dt>Tables</dt><dd>{result.tables?.length ?? 0}</dd></div>
      <div><dt>Created</dt><dd>{date(result.createdAt)}</dd></div>
    </dl>
    {!!scientificValues.length && <dl className="qz-analysis-summary">
      {scientificValues.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{display(value)}</dd></div>)}
    </dl>}
    {typeof interpretation === "string" && <p className="qz-analysis-caption">{interpretation}</p>}
    {result.producer.id !== "williamson-hall" && <StatisticalReportingCard result={result} />}
  </>;

  if (view === "table") return result.tables?.length ? <div>
    {result.tables.map((table, index) => <section key={`${table.title ?? "table"}-${index}`} className="qz-analysis-snapshot-table">
      <header>
        <h4>{table.title || `Table ${index + 1}`}</h4>
        <span className="qz-analysis-snapshot-table-actions">
          {onCopy && <Button size="sm" disabled={disabled} onClick={() => onCopy(index)}>Copy table</Button>}
          <Button size="sm" disabled={disabled} onClick={() => onExport(index)}>Export table…</Button>
        </span>
      </header>
      {(() => {
        const rows = table.rows.slice(0, 100);
        const links = source ? statisticalResultTableSelections(result, source, index, rows.length) : [];
        const linked = links.some((link) => link !== null);
        return <DataTable columns={linked ? [...table.columns, "Source"] : table.columns} rows={rows.map((row, rowIndex) => [
          ...row.map((cell) => typeof cell === "number" ? fmtNum(cell) : (cell ?? "—")),
          ...(linked ? [links[rowIndex] ? <Button key="source" size="sm"
            disabled={disabled || !selectionEnabled || !links[rowIndex]!.rows.length}
            title={!selectionEnabled ? "Run the analysis again before linking rows from an out-of-date result." : links[rowIndex]!.label}
            onClick={() => onSelectRows?.(links[rowIndex]!.rows)}>{links[rowIndex]!.label}</Button> : "—"] : []),
        ])} />;
      })()}
      {table.rows.length > 100 && <p className="qz-analysis-caption">Showing 100 of {table.rows.length} rows. Export includes the complete table.</p>}
    </section>)}
    <div className="qz-analysis-snapshot-actions">
      {onCopy && <Button disabled={disabled} onClick={() => onCopy()}>Copy all tables</Button>}
      <Button disabled={disabled} onClick={() => onExport()}>Export all tables…</Button>
    </div>
  </div> : <p className="qz-analysis-empty">No saved tables are available.</p>;

  const params = result.parameters ?? {};
  return <dl className="qz-analysis-summary">
    <div><dt>Producer</dt><dd>{result.producer.id} · v{result.producer.version}</dd></div>
    <div><dt>Result schema</dt><dd>v{result.version}</dd></div>
    <div><dt>Source ID</dt><dd>{result.sources.map((item) => item.datasetId).join(", ") || "None"}</dd></div>
    {Object.entries(params).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{display(value)}</dd></div>)}
    <div><dt>Last updated</dt><dd>{date(result.updatedAt ?? result.createdAt)}</dd></div>
  </dl>;
}
