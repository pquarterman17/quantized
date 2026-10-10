import type { AnalysisResult, AnalysisResultValue } from "../../../lib/analysisResult";
import { statisticalResultSourceless } from "../../../lib/analysisResultFreshness";
import { fmtNum } from "../../../lib/format";
import type { Dataset } from "../../../lib/types";
import { Button } from "../../primitives";
import { DataTable } from "../../primitives/DataTable";

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

export default function AnalysisResultStatisticalTest({ result, source, view, onExport, disabled = false }: {
  result: AnalysisResult;
  source: Dataset | undefined;
  view: "overview" | "table" | "provenance";
  onExport: () => void;
  disabled?: boolean;
}) {
  const interpretation = result.scalarValues?.Interpretation;
  if (view === "overview") return (
    <>
      <dl className="qz-analysis-summary">
        <div><dt>Analysis</dt><dd>{String(result.scalarValues?.Test ?? result.producer.label)}</dd></div>
        <div><dt>Source</dt><dd>{source?.name ?? (statisticalResultSourceless(result) && !result.sources.length ? "No worksheet required" : "Missing source")}</dd></div>
        <div><dt>Tables</dt><dd>{result.tables?.length ?? 0}</dd></div>
        <div><dt>Created</dt><dd>{date(result.createdAt)}</dd></div>
      </dl>
      {typeof interpretation === "string" && <p className="qz-analysis-caption">{interpretation}</p>}
    </>
  );

  if (view === "table") return result.tables?.length ? (
    <div>
      {result.tables.map((table, index) => (
        <section key={`${table.title ?? "table"}-${index}`} style={{ marginBottom: 12 }}>
          {table.title && <h4>{table.title}</h4>}
          <DataTable columns={table.columns} rows={table.rows.slice(0, 100).map((row) => row.map((cell) =>
            typeof cell === "number" ? fmtNum(cell) : (cell ?? "—")))} />
          {table.rows.length > 100 && <p className="qz-analysis-caption">Showing 100 of {table.rows.length} rows. Export includes the complete table.</p>}
        </section>
      ))}
      <Button disabled={disabled} onClick={onExport}>Export all tables…</Button>
    </div>
  ) : <p className="qz-analysis-empty">No saved tables are available.</p>;

  const params = result.parameters ?? {};
  return (
    <dl className="qz-analysis-summary">
      <div><dt>Producer</dt><dd>{result.producer.id} · v{result.producer.version}</dd></div>
      <div><dt>Result schema</dt><dd>v{result.version}</dd></div>
      <div><dt>Source ID</dt><dd>{result.sources.map((item) => item.datasetId).join(", ") || "None"}</dd></div>
      {Object.entries(params).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{display(value)}</dd></div>)}
      <div><dt>Last updated</dt><dd>{date(result.updatedAt ?? result.createdAt)}</dd></div>
    </dl>
  );
}
