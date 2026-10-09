import type { AnalysisResult } from "../../../lib/analysisResult";
import type { Dataset, FitSpec } from "../../../lib/types";

function number(value: number | undefined): string {
  if (value === undefined) return "Not reported";
  const magnitude = Math.abs(value);
  return magnitude !== 0 && (magnitude >= 1e5 || magnitude < 1e-4)
    ? value.toExponential(6)
    : value.toLocaleString(undefined, { maximumSignificantDigits: 8 });
}

function date(value: string | undefined): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString();
}

function channel(dataset: Dataset | undefined, key: number | null | undefined, fallback: string): string {
  if (key === null) return "Independent / time axis";
  if (key === undefined) return fallback;
  if (!dataset || key < 0 || key >= dataset.data.labels.length) return `Missing channel ${key + 1}`;
  const unit = dataset.data.units[key];
  return `${dataset.data.labels[key]}${unit ? ` (${unit})` : ""}`;
}

export default function AnalysisResultFitOverview({ result, source, spec, provenance = false }: {
  result: AnalysisResult;
  source: Dataset | undefined;
  spec: FitSpec | null;
  provenance?: boolean;
}) {
  if (!spec) return <p className="qz-analysis-empty">The source worksheet no longer has a saved curve fit.</p>;
  if (provenance) return <dl className="qz-analysis-summary">
    <div><dt>Producer</dt><dd>{result.producer.id} · v{result.producer.version}</dd></div>
    <div><dt>Result schema</dt><dd>v{result.version}</dd></div>
    <div><dt>Source ID</dt><dd>{source?.id ?? result.sources[0]?.datasetId ?? "None"}</dd></div>
    <div><dt>Settings authority</dt><dd>{result.settingsRef ? `${result.settingsRef.datasetId}.${result.settingsRef.field}` : "Not recorded"}</dd></div>
    <div><dt>Starting values</dt><dd>{spec.p0?.map(number).join(", ") || "Model defaults"}</dd></div>
    <div><dt>Bounds</dt><dd>{spec.lower || spec.upper ? "Recorded in fit recipe" : "Model defaults"}</dd></div>
    <div><dt>Preprocessing</dt><dd>{spec.preprocessing?.join(", ") || "None recorded"}</dd></div>
    <div><dt>Uncertainty</dt><dd>{spec.uncertainty === "covariance" ? "Covariance matrix" : "Not computed"}</dd></div>
    <div><dt>Fitted</dt><dd>{date(spec.fittedAt ?? result.createdAt)}</dd></div>
    <div><dt>Last recomputed</dt><dd>{date(spec.recomputedAt)}</dd></div>
  </dl>;
  return <>
    <dl className="qz-analysis-summary">
      <div><dt>Analysis</dt><dd>{result.producer.label}</dd></div>
      <div><dt>Source</dt><dd>{source?.name ?? "Missing source"}</dd></div>
      <div><dt>Model</dt><dd>{spec.model}</dd></div>
      <div><dt>Y channel</dt><dd>{channel(source, spec.yKey, "Legacy selection")}</dd></div>
      <div><dt>X axis</dt><dd>{channel(source, spec.xKey, "Legacy selection")}</dd></div>
      <div><dt>Range</dt><dd>{spec.range?.map(number).join(" to ") ?? "Full analysis view"}</dd></div>
      <div><dt>Points</dt><dd>{spec.nPoints?.toLocaleString() ?? "Not recorded"}</dd></div>
      <div><dt>Weighting</dt><dd>{spec.weight?.mode ?? "none"}</dd></div>
      <div><dt>Converged</dt><dd>{spec.exitFlag === undefined ? "Not reported" : spec.exitFlag === 1 ? "Yes" : "No"}</dd></div>
      <div><dt>R²</dt><dd>{number(spec.R2)}</dd></div>
      <div><dt>RMSE</dt><dd>{number(spec.RMSE)}</dd></div>
      <div><dt>AIC</dt><dd>{number(spec.AIC)}</dd></div>
      <div><dt>Reduced χ²</dt><dd>{number(spec.chiSqRed)}</dd></div>
    </dl>
    <p className="qz-analysis-caption">Values are read live from the source worksheet’s saved fit. Recalculate updates this result in place; Edit / Re-fit opens the recorded model and channels.</p>
  </>;
}
