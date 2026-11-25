// Figure drafts of the Time series, DOE effects and Profiler result kinds
// (owner decision 2026-11-25), read from the SAVED tables only (the
// lib/statisticalResultFigures rule): the plotted numbers are exactly the saved
// output and never consult the live source. A table whose shape is not the one
// its builder writes draws nothing.

import type { AnalysisResult, AnalysisResultTable } from "./analysisResult";
import { defaultPlotView } from "./plotview";
import type { StatisticalResultFigureDraft } from "./statisticalResultFigures";
import { DOE_EFFECTS_RESULT, PROFILER_RESULT, TIME_SERIES_RESULT } from "./toolResultKinds";
import type { DataStruct } from "./types";

type Cell = string | number | null;
const num = (v: Cell | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN);
const find = (result: AnalysisResult, title: string, width: number): AnalysisResultTable | undefined =>
  result.tables?.find((t) => t.title === title && t.columns.length === width && t.rows.length > 0);

function draft(key: string, name: string, description: string, table: AnalysisResultTable, cols: number[],
  mark: StatisticalResultFigureDraft["mark"], xLabel = table.columns[0]!, yLabel = table.columns[cols[0]!]!): StatisticalResultFigureDraft {
  const data: DataStruct = {
    time: table.rows.map((row) => num(row[0])),
    values: table.rows.map((row) => cols.map((c) => num(row[c]))),
    labels: cols.map((c) => table.columns[c]!), units: cols.map(() => ""),
    metadata: { frozenFromAnalysisResult: true },
  };
  const view = { ...defaultPlotView(), plotTitle: name, xAxisLabel: xLabel, yAxisLabel: yLabel, xKey: null, yKeys: cols.map((_, i) => i), showLegend: cols.length > 1 };
  return { key, name, description, data, view, mark };
}

/** A categorical X (term or level names) as channel 0 with its levels. */
function categorical(key: string, name: string, description: string, table: AnalysisResultTable, cols: number[], yLabel: string): StatisticalResultFigureDraft {
  const levels = table.rows.map((row) => String(row[0] ?? ""));
  const data: DataStruct = {
    time: levels.map((_, i) => i), values: table.rows.map((row, i) => [i, ...cols.map((c) => num(row[c]))]),
    labels: [table.columns[0]!, ...cols.map((c) => table.columns[c]!)], units: ["", ...cols.map(() => "")],
    metadata: { frozenFromAnalysisResult: true }, cat_levels: { 0: levels },
  };
  const view = { ...defaultPlotView(), plotTitle: name, xAxisLabel: table.columns[0]!, yAxisLabel: yLabel, xKey: 0, yKeys: cols.map((_, i) => i + 1), showLegend: cols.length > 1 };
  return { key, name, description, data, view, mark: "bar" };
}

function timeSeriesFigures(result: AnalysisResult): StatisticalResultFigureDraft[] {
  const out: StatisticalResultFigureDraft[] = [];
  const corr = find(result, "Correlogram", 5);
  if (corr) {
    const lagged = { ...corr, rows: corr.rows.filter((row) => num(row[0]) > 0) };
    out.push(draft("ts-acf", "Autocorrelation (ACF)", "Saved ACF with its Bartlett band.", lagged, [1, 2], "scatter", "lag (samples)", "ACF"));
    out.push(draft("ts-pacf", "Partial autocorrelation (PACF)", "Saved PACF with its white-noise band.", lagged, [3, 4], "scatter", "lag (samples)", "PACF"));
  }
  const dec = find(result, "Decomposition", 5);
  if (dec) {
    out.push(draft("ts-trend", "Observed and trend", "Saved series and centred-average trend.", dec, [1, 2], "line"));
    out.push(draft("ts-seasonal", "Seasonal component", "Saved seasonal component.", dec, [3], "line"));
    out.push(draft("ts-remainder", "Remainder", "Saved remainder.", dec, [4], "scatter"));
  }
  const seg = find(result, "Series and segment means", 3);
  if (seg) out.push(draft("ts-changepoints", "Series and segment means", "Saved series with the mean of each segment between change points.", seg, [1, 2], "line"));
  const fc = find(result, "Fit and forecast", 6);
  if (fc) out.push(draft("ts-arima", "ARIMA fit and forecast", "Saved series, in-sample fit and forecast with its interval.", fc, [1, 2, 3, 4, 5], "line"));
  return out;
}

function effectsFigures(result: AnalysisResult): StatisticalResultFigureDraft[] {
  const t = find(result, "Effects", 6);
  if (!t) return [];
  const byQuantile = { ...t, columns: ["half-normal quantile", "|effect|"], rows: t.rows.map((row) => [row[3] ?? null, row[2] ?? null]) };
  return [
    categorical("doe-pareto", "Pareto of effects", "Saved |effect| per term, largest first.", t, [2], "|effect|"),
    draft("doe-half-normal", "Half-normal plot of effects", "Saved |effect| against its half-normal quantile (Daniel 1959).", byQuantile, [1], "scatter"),
  ];
}

function profilerFigures(result: AnalysisResult): StatisticalResultFigureDraft[] {
  return (result.tables ?? []).flatMap((t, index): StatisticalResultFigureDraft[] => {
    if (!t.title?.startsWith("Prediction trace: ") || t.columns.length < 5 || !t.rows.length) return [];
    const factor = t.title.slice("Prediction trace: ".length);
    const name = `${factor} prediction trace`;
    const description = "Saved predicted response with its confidence interval, the other factors at the saved settings.";
    return typeof t.rows[0]![0] === "string"
      ? [categorical(`profiler-trace-${index}`, name, description, t, [1, 3, 4], "predicted")]
      : [draft(`profiler-trace-${index}`, name, description, t, [1, 3, 4], "line", factor, "predicted")];
  });
}

export function toolResultFigureDrafts(result: AnalysisResult): StatisticalResultFigureDraft[] | null {
  switch (result.producer.id) {
    case TIME_SERIES_RESULT: return timeSeriesFigures(result);
    case DOE_EFFECTS_RESULT: return effectsFigures(result);
    case PROFILER_RESULT: return profilerFigures(result);
    default: return null;
  }
}
