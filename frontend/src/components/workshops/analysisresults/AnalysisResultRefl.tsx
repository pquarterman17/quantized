import type { AnalysisResult } from "../../../lib/analysisResult";
import type { Dataset } from "../../../lib/types";
import { posteriorCaveat } from "../reflectivity/reflPosterior";
import { recordsFor, type ReflFitRecord } from "../reflectivity/reflFitRecord";
import { recordIssues, type RecordIssues } from "../reflectivity/reflFitRestore";

const NO_ISSUES: RecordIssues = { missing: [], changed: [] };

function value(number: number | null): string {
  if (number === null || !Number.isFinite(number)) return "—";
  const magnitude = Math.abs(number);
  return magnitude !== 0 && (magnitude >= 1e5 || magnitude < 1e-4)
    ? number.toExponential(6)
    : number.toLocaleString(undefined, { maximumSignificantDigits: 8 });
}

function date(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString();
}

export function liveReflectivityFit(
  result: AnalysisResult | undefined,
  datasets: readonly Dataset[],
): ReflFitRecord | null {
  const ref = result?.settingsRef;
  if (!result || ref?.field !== "reflFits") return null;
  for (const source of result.sources) {
    const dataset = datasets.find((item) => item.id === source.datasetId);
    const record = recordsFor(dataset).find((item) => item.id === ref.recordId);
    if (record) return record;
  }
  return null;
}

export function reflectivityFitIssues(
  record: ReflFitRecord | null,
  datasets: readonly Dataset[],
): RecordIssues {
  return record ? recordIssues(record, datasets) : NO_ISSUES;
}

export default function AnalysisResultRefl({ result, record, datasets, view }: {
  result: AnalysisResult;
  record: ReflFitRecord | null;
  datasets: readonly Dataset[];
  view: "overview" | "table" | "provenance";
}) {
  if (!record) return <p className="qz-analysis-empty">The saved reflectivity fit is unavailable until one of its source worksheets is restored.</p>;
  if (view === "table") {
    const posterior = new Map(record.posterior?.parameters.map((item) => [item.name, item]));
    return <div className="qz-analysis-table-view">
      <p className="qz-analysis-caption">{record.result.parameters.length} fitted parameter{record.result.parameters.length === 1 ? "" : "s"}</p>
      <div className="qz-analysis-table-wrap"><table className="qz-analysis-table">
        <thead><tr><th>Parameter</th><th>Value</th><th>± 1σ</th><th>68% interval</th><th>State</th></tr></thead>
        <tbody>{record.result.parameters.map((parameter) => {
          const sampled = posterior.get(parameter.name);
          return <tr key={parameter.name}>
            <td>{parameter.name}</td><td>{value(parameter.value)}</td><td>{value(parameter.stderr)}</td>
            <td>{sampled ? `${value(sampled.interval68[0])} to ${value(sampled.interval68[1])}` : "—"}</td>
            <td>{parameter.tie ? `Tied: ${parameter.tie}` : parameter.vary ? "Fitted" : "Held"}{parameter.at_bound ? " · at bound" : ""}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </div>;
  }
  const issues = recordIssues(record, datasets);
  const caveat = record.posterior ? posteriorCaveat(record.posterior) : null;
  if (view === "provenance") return <dl className="qz-analysis-summary">
    <div><dt>Producer</dt><dd>{result.producer.id} · v{result.producer.version}</dd></div>
    <div><dt>Result schema</dt><dd>v{result.version}</dd></div>
    <div><dt>Record ID</dt><dd>{record.id}</dd></div>
    <div><dt>Source IDs</dt><dd>{result.sources.map((source) => source.datasetId).join(", ")}</dd></div>
    <div><dt>Weighting</dt><dd>{record.result.weighting}</dd></div>
    <div><dt>Evaluations</dt><dd>{record.result.n_evaluations.toLocaleString()}</dd></div>
    <div><dt>Fitted</dt><dd>{date(record.fittedAt)}</dd></div>
  </dl>;
  return <>
    <dl className="qz-analysis-summary">
      <div><dt>Analysis</dt><dd>{result.producer.label}</dd></div>
      <div><dt>Sources</dt><dd>{record.request.channels.map((channel) => datasets.find((item) => item.id === channel.datasetId)?.name ?? channel.datasetName).join(", ")}</dd></div>
      <div><dt>Channels</dt><dd>{record.request.channels.length}</dd></div>
      <div><dt>Points</dt><dd>{record.result.n_points.toLocaleString()}</dd></div>
      <div><dt>Free parameters</dt><dd>{record.result.n_free}</dd></div>
      <div><dt>{record.result.objective.label}</dt><dd>{value(record.result.objective.value)}</dd></div>
      <div><dt>Converged</dt><dd>{record.result.success ? "Yes" : "No"}</dd></div>
      <div><dt>Saved curves</dt><dd>{record.curves ? `${record.curves.channels.length} reflectivity · ${record.curves.sld.length} SLD` : "Not stored"}</dd></div>
      <div><dt>Posterior</dt><dd>{record.posterior ? `${record.posterior.convergence.n_draws.toLocaleString()} draws` : "Not estimated"}</dd></div>
    </dl>
    {issues.changed.length > 0 && <p className="qz-analysis-caption">The source data changed after this fit. Restore the setup and re-fit before using these values.</p>}
    {caveat && <p className="qz-analysis-caption">{caveat}</p>}
  </>;
}
