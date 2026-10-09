import type { AnalysisResult } from "../../../lib/analysisResult";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { Button } from "../../primitives";

function previewPath(dataset: Dataset, channel: number): string | null {
  const all = dataset.data.values.map((row, index) => ({ index, value: row?.[channel] }))
    .filter((point): point is { index: number; value: number } => Number.isFinite(point.value));
  if (all.length < 2) return null;
  const step = Math.max(1, Math.ceil(all.length / 120));
  const points = all.filter((_, index) => index % step === 0 || index === all.length - 1);
  const values = points.map((point) => point.value);
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const xSpan = Math.max(1, dataset.data.time.length - 1);
  return points.map((point, index) => {
    const x = 4 + (point.index / xSpan) * 192;
    const y = hi === lo ? 32 : 58 - ((point.value - lo) / span) * 52;
    return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function FigureCard({ result, index, onOpen, onBuild, onReport }: {
  result: AnalysisResult;
  index: number;
  onOpen: (index: number) => void;
  onBuild: (index: number) => void;
  onReport: (index: number) => void;
}) {
  const datasets = useApp((state) => state.datasets);
  const binding = result.plotBindings![index];
  const dataset = datasets.find((item) => item.id === binding.datasetId);
  const channels = dataset
    ? binding.channels.filter((channel) => Number.isInteger(channel) && channel >= 0 && channel < dataset.data.labels.length)
    : [];
  const path = dataset && channels.length ? previewPath(dataset, channels[0]) : null;
  const unavailable = !dataset || channels.length === 0;
  const sourceOnly = result.settingsRef?.field === "peakTable";
  const fitted = result.settingsRef?.field === "fitSpec";
  const fittedPlotUnavailable = unavailable || (fitted && !dataset?.fitSpec?.params?.length);
  return <article className={`qz-analysis-figure-card${unavailable ? " unavailable" : ""}`}>
    <div className="qz-analysis-figure-preview">
      {path ? <svg viewBox="0 0 200 64" role="img" aria-label={`Preview of ${dataset!.name}`} preserveAspectRatio="none">
        <path d={path} />
      </svg> : <span>{dataset ? "No plottable channels" : "Worksheet unavailable"}</span>}
    </div>
    <div className="qz-analysis-figure-info">
      <strong>{dataset?.name ?? binding.datasetId}</strong>
      <span>{channels.map((channel) => dataset!.data.labels[channel]).join(", ") || "Saved binding unavailable"}</span>
      <div className="qz-analysis-figure-actions">
        <Button size="sm" disabled={fittedPlotUnavailable} onClick={() => onOpen(index)}>{sourceOnly ? "Open source plot" : fitted ? "Open fitted plot" : "Open plot"}</Button>
        <Button size="sm" disabled={unavailable} onClick={() => onBuild(index)}>{sourceOnly || fitted ? "Build source figure" : "Build figure"}</Button>
        <Button size="sm" disabled={fittedPlotUnavailable} onClick={() => onReport(index)}>{sourceOnly ? "Send source to report…" : fitted ? "Send fitted plot to report…" : "Send to report…"}</Button>
      </div>
    </div>
  </article>;
}

export default function AnalysisResultFigures({ result, onOpen, onBuild, onReport }: {
  result: AnalysisResult;
  onOpen: (index: number) => void;
  onBuild: (index: number) => void;
  onReport: (index: number) => void;
}) {
  if (!result.plotBindings?.length) return <p className="qz-analysis-empty">No figure bindings were recorded for this result.</p>;
  const sourceOnly = result.settingsRef?.field === "peakTable";
  const fitted = result.settingsRef?.field === "fitSpec";
  return <div className="qz-analysis-figures">
    <p className="qz-analysis-caption">{sourceOnly
      ? "These actions plot the recorded source curve only. The peak table and CSV preserve fitted values; a reusable fitted curve is not stored in this result."
      : fitted
        ? "Open plot and Send to report regenerate the fitted curve from the saved model and parameters. Build source figure starts an editable draft from the recorded source curve; editable figures do not yet store fit overlays."
      : `Figures use the result’s recorded ${result.outputs.length ? "output" : "source"} and channels. Build figure opens an editable draft; Send to report captures the configured plot.`}</p>
    {result.plotBindings.map((binding, index) => <FigureCard key={`${binding.datasetId}-${index}`} result={result} index={index} onOpen={onOpen} onBuild={onBuild} onReport={onReport} />)}
  </div>;
}
