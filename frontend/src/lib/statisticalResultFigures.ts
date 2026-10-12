import type { AnalysisResult, AnalysisResultTable } from "./analysisResult";
import type { ErrorBinding } from "./errorRoles";
import type { PlotMark } from "./plotMarks";
import { defaultPlotView, type PlotView } from "./plotview";
import type { DataStruct } from "./types";

export interface StatisticalResultFigureDraft {
  key: string;
  name: string;
  description: string;
  data: DataStruct;
  view: PlotView;
  mark: PlotMark;
  errors?: ErrorBinding[];
}

const table = (result: AnalysisResult, title: string): AnalysisResultTable | undefined =>
  result.tables?.find((candidate) => candidate.title === title);

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown): string => typeof value === "string" ? value : String(value ?? "");
const columnsAre = (source: AnalysisResultTable, expected: readonly string[]): boolean =>
  source.columns.length === expected.length && expected.every((label, index) => source.columns[index] === label);

function view(name: string, xLabel: string, yLabel: string, xKey: number | null, yKeys: number[]): PlotView {
  return {
    ...defaultPlotView(),
    plotTitle: name,
    xAxisLabel: xLabel,
    yAxisLabel: yLabel,
    xKey,
    yKeys,
    showLegend: yKeys.length > 1,
  };
}

function xyData(x: number[], series: { label: string; values: number[]; unit?: string }[]): DataStruct {
  return {
    time: x,
    values: x.map((_, row) => series.map((item) => item.values[row] ?? Number.NaN)),
    labels: series.map((item) => item.label),
    units: series.map((item) => item.unit ?? ""),
    metadata: { frozenFromAnalysisResult: true },
  };
}

function categoricalData(
  levels: string[],
  xLabel: string,
  series: { label: string; values: number[]; unit?: string }[],
): DataStruct {
  return {
    time: levels.map((_, index) => index),
    values: levels.map((_, row) => [row, ...series.map((item) => item.values[row] ?? Number.NaN)]),
    labels: [xLabel, ...series.map((item) => item.label)],
    units: ["", ...series.map((item) => item.unit ?? "")],
    metadata: { frozenFromAnalysisResult: true },
    cat_levels: { 0: levels },
  };
}

function distributionFigures(result: AnalysisResult): StatisticalResultFigureDraft[] {
  const column = text(result.scalarValues?.Column) || "Value";
  return (result.tables ?? []).flatMap((candidate, index) => {
    if (!(candidate.title === "Histogram" || candidate.title?.startsWith("Histogram · ")) ||
        !columnsAre(candidate, ["bin left", "center", "bin right", "count"])) return [];
    const rows = candidate.rows.filter((row) => finite(row[1]) && finite(row[3]));
    if (!rows.length) return [];
    const level = candidate.title === "Histogram" ? "" : candidate.title!.slice("Histogram · ".length);
    const name = `${column} distribution${level ? ` · ${level}` : ""}`;
    const data = xyData(rows.map((row) => row[1] as number), [{ label: "Count", values: rows.map((row) => row[3] as number) }]);
    return [{
      key: `distribution-histogram-${index}`,
      name,
      description: `Histogram saved with this result${level ? ` for ${level}` : ""}.`,
      data,
      view: view(name, column, "Count", null, [0]),
      mark: "bar",
    }];
  });
}

function onewayFigures(result: AnalysisResult, source: AnalysisResultTable): StatisticalResultFigureDraft[] {
  if (!columnsAre(source, ["level", "group", "N", "mean", "sd"])) return [];
  const levels = [...new Set(source.rows.map((row) => text(row[0])))];
  const yLabel = text(result.scalarValues?.["Y column"]) || "Mean";
  return levels.flatMap((level, index) => {
    const rows = source.rows.filter((row) => text(row[0]) === level && finite(row[3]));
    if (!rows.length) return [];
    const groups = rows.map((row) => text(row[1]));
    const means = rows.map((row) => row[3] as number);
    const sd = rows.map((row) => finite(row[4]) ? row[4] as number : Number.NaN);
    const hasSd = sd.some(Number.isFinite);
    const data = categoricalData(groups, text(result.scalarValues?.["X column"]) || "Group", [
      { label: yLabel, values: means }, ...(hasSd ? [{ label: `${yLabel} SD`, values: sd }] : []),
    ]);
    const name = `${yLabel} by group${level === "All" ? "" : ` · ${level}`}`;
    return [{
      key: `fit-y-by-x-oneway-${index}`,
      name,
      description: "Saved group means with standard-deviation error bars.",
      data,
      view: view(name, data.labels[0], yLabel, 0, [1]),
      mark: "bar",
      ...(hasSd ? { errors: [{ channel: 2, target: 1, axis: "y", side: "both" } as const] } : {}),
    }];
  });
}

function bivariateFigures(result: AnalysisResult, source: AnalysisResultTable): StatisticalResultFigureDraft[] {
  if (!columnsAre(source, ["level", "X", "fitted Y"])) return [];
  const levels = [...new Set(source.rows.map((row) => text(row[0])))];
  const xLabel = text(result.scalarValues?.["X column"]) || "X";
  const yLabel = text(result.scalarValues?.["Y column"]) || "Fitted Y";
  return levels.flatMap((level, index) => {
    const rows = source.rows.filter((row) => text(row[0]) === level && finite(row[1]) && finite(row[2]));
    if (!rows.length) return [];
    const name = `${yLabel} fitted curve${level === "All" ? "" : ` · ${level}`}`;
    const data = xyData(rows.map((row) => row[1] as number), [{ label: "Fitted Y", values: rows.map((row) => row[2] as number) }]);
    return [{ key: `fit-y-by-x-curve-${index}`, name,
      description: "Fitted curve saved with this result. Observations remain in the source worksheet.",
      data, view: view(name, xLabel, yLabel, null, [0]), mark: "line" }];
  });
}

function regressionBandFigures(result: AnalysisResult, source: AnalysisResultTable): StatisticalResultFigureDraft[] {
  if (!columnsAre(source, ["level", "X", "lower", "upper", "alpha"])) return [];
  const levels = [...new Set(source.rows.map((row) => text(row[0])))];
  const xLabel = text(result.scalarValues?.["X column"]) || "X";
  const yLabel = text(result.scalarValues?.["Y column"]) || "Y";
  return levels.flatMap((level, index) => {
    const rows = source.rows.filter((row) => text(row[0]) === level && finite(row[1]) && finite(row[2]) && finite(row[3]));
    if (!rows.length) return [];
    const data = xyData(rows.map((row) => row[1] as number), [
      { label: "Lower bound", values: rows.map((row) => row[2] as number) },
      { label: "Upper bound", values: rows.map((row) => row[3] as number) },
    ]);
    const name = `${yLabel} regression interval${level === "All" ? "" : ` · ${level}`}`;
    return [{ key: `fit-y-by-x-band-${index}`, name,
      description: "Lower and upper regression-interval bounds saved with this result.",
      data, view: view(name, xLabel, yLabel, null, [0, 1]), mark: "line" }];
  });
}

function contingencyFigures(result: AnalysisResult, source: AnalysisResultTable): StatisticalResultFigureDraft[] {
  if (!columnsAre(source, ["level", "row", "column", "observed", "expected"])) return [];
  const levels = [...new Set(source.rows.map((row) => text(row[0])))];
  return levels.flatMap((level, index) => {
    const rows = source.rows.filter((row) => text(row[0]) === level && finite(row[3]));
    const rowLevels = [...new Set(rows.map((row) => text(row[1])))];
    const columns = [...new Set(rows.map((row) => text(row[2])))];
    if (!rowLevels.length || !columns.length) return [];
    const series = columns.map((column) => ({ label: column, values: rowLevels.map((rowLevel) => {
      const match = rows.find((row) => text(row[1]) === rowLevel && text(row[2]) === column);
      return match && finite(match[3]) ? match[3] : Number.NaN;
    }) }));
    const data = categoricalData(rowLevels, text(result.scalarValues?.["X column"]) || "Category", series);
    const name = `Observed counts${level === "All" ? "" : ` · ${level}`}`;
    return [{ key: `fit-y-by-x-contingency-${index}`, name,
      description: "Observed contingency-table counts saved with this result.",
      data, view: view(name, data.labels[0], "Count", 0, series.map((_, i) => i + 1)), mark: "bar" }];
  });
}

function fitYByXFigures(result: AnalysisResult): StatisticalResultFigureDraft[] {
  const mode = result.parameters?.mode ?? result.scalarValues?.Mode;
  if (mode === "oneway") {
    const source = table(result, "Group summaries");
    return source ? onewayFigures(result, source) : [];
  }
  if (mode === "bivariate") {
    const source = table(result, "Fitted curve");
    const band = table(result, "Regression band");
    return [...(source ? bivariateFigures(result, source) : []), ...(band ? regressionBandFigures(result, band) : [])];
  }
  if (mode === "contingency") {
    const source = table(result, "Contingency cells");
    return source ? contingencyFigures(result, source) : [];
  }
  return [];
}

function multivariateFigures(result: AnalysisResult): StatisticalResultFigureDraft[] {
  const out: StatisticalResultFigureDraft[] = [];
  const components = table(result, "PCA component summary");
  const componentRows = components && columnsAre(components,
    ["component", "eigenvalue", "explained %", "cumulative %", "singular value"])
    ? components.rows.filter((row) => finite(row[2]) && finite(row[3])) : [];
  if (componentRows.length) {
    const levels = componentRows.map((row) => text(row[0]));
    const data = categoricalData(levels, "Component", [
      { label: "Explained %", values: componentRows.map((row) => row[2] as number), unit: "%" },
      { label: "Cumulative %", values: componentRows.map((row) => row[3] as number), unit: "%" },
    ]);
    out.push({ key: "multivariate-scree", name: "PCA explained variance",
      description: "Explained and cumulative variance from the saved PCA component table.",
      data, view: view("PCA explained variance", "Component", "Variance (%)", 0, [1, 2]), mark: "line" });
  }
  const scores = table(result, "PCA scores");
  const recipe = result.parameters?.recipe;
  const recipeObject = typeof recipe === "object" && recipe !== null && !Array.isArray(recipe) ? recipe : {};
  const pcX = typeof recipeObject.pcX === "number" && Number.isInteger(recipeObject.pcX) ? recipeObject.pcX : 0;
  const pcY = typeof recipeObject.pcY === "number" && Number.isInteger(recipeObject.pcY) ? recipeObject.pcY : 1;
  const xColumn = pcX + 1, yColumn = pcY + 1;
  const validScoreColumns = scores?.columns[0] === "source row" &&
    scores.columns.slice(1).every((label, index) => label === `PC${index + 1}`);
  const scoreRows = scores && validScoreColumns
    ? scores.rows.filter((row) => finite(row[xColumn]) && finite(row[yColumn])) : [];
  if (scores && validScoreColumns && pcX !== pcY && scores.columns[xColumn] && scores.columns[yColumn] && scoreRows.length) {
    const xLabel = scores.columns[xColumn], yLabel = scores.columns[yColumn];
    const data = xyData(scoreRows.map((row) => row[xColumn] as number), [
      { label: yLabel, values: scoreRows.map((row) => row[yColumn] as number) },
    ]);
    out.push({ key: "multivariate-scores", name: `PCA scores · ${xLabel} / ${yLabel}`,
      description: "Score coordinates saved with this result; omitted source rows remain omitted.",
      data, view: view(`PCA scores · ${xLabel} / ${yLabel}`, xLabel, yLabel, null, [0]), mark: "scatter" });
  }
  return out;
}

function variabilityFigures(result: AnalysisResult): StatisticalResultFigureDraft[] {
  const out: StatisticalResultFigureDraft[] = [];
  const components = table(result, "Variance components");
  const componentRows = components && columnsAre(components,
    ["component", "variance", "raw estimate", "% total", "clamped"])
    ? components.rows.filter((row) => finite(row[3])) : [];
  if (componentRows.length) {
    const data = categoricalData(componentRows.map((row) => text(row[0])), "Component", [
      { label: "% total", values: componentRows.map((row) => row[3] as number), unit: "%" },
    ]);
    out.push({ key: "variability-components", name: "Variance components",
      description: "Percentage of total variance saved for each component.", data,
      view: view("Variance components", "Component", "Total variance (%)", 0, [1]), mark: "bar" });
  }
  const cells = table(result, "Cell summaries");
  const validCells = cells?.columns.length === 5 && cells.columns[2] === "N" &&
    cells.columns[3] === "mean" && cells.columns[4] === "sd";
  const cellRows = cells && validCells ? cells.rows.filter((row) => finite(row[3])) : [];
  if (cells && validCells && cellRows.length) {
    const labels = cellRows.map((row) => `${text(row[0])} / ${text(row[1])}`);
    const means = cellRows.map((row) => row[3] as number);
    const sd = cellRows.map((row) => finite(row[4]) ? row[4] as number : Number.NaN);
    const hasSd = sd.some(Number.isFinite);
    const yLabel = text(result.scalarValues?.Response) || "Mean";
    const data = categoricalData(labels, `${cells.columns[0]} / ${cells.columns[1]}`, [
      { label: yLabel, values: means }, ...(hasSd ? [{ label: `${yLabel} SD`, values: sd }] : []),
    ]);
    out.push({ key: "variability-cells", name: `${yLabel} cell means`,
      description: "Saved nested-cell means with standard-deviation error bars.", data,
      view: view(`${yLabel} cell means`, data.labels[0], yLabel, 0, [1]), mark: "bar",
      ...(hasSd ? { errors: [{ channel: 2, target: 1, axis: "y", side: "both" } as const] } : {}) });
  }
  return out;
}

function outlierFigures(result: AnalysisResult): StatisticalResultFigureDraft[] {
  const out: StatisticalResultFigureDraft[] = [];
  const flagged = table(result, "Flagged rows");
  const flaggedRows = flagged && columnsAre(flagged, ["source row", "value", "statistic"])
    ? flagged.rows.filter((row) => finite(row[0]) && finite(row[1])) : [];
  if (flaggedRows.length) {
    const label = text(result.scalarValues?.Channel) || "Value";
    const data = xyData(flaggedRows.map((row) => row[0] as number), [
      { label, values: flaggedRows.map((row) => row[1] as number) },
    ]);
    out.push({ key: "outlier-flagged", name: `${label} flagged observations`,
      description: "Only observations flagged by the saved screening result are shown.", data,
      view: view(`${label} flagged observations`, "Source row", label, null, [0]), mark: "scatter" });
  }
  const rosner = table(result, "Rosner sequence");
  const rosnerRows = rosner && columnsAre(rosner,
    ["step", "R", "critical lambda", "source row", "value", "exceeds"])
    ? rosner.rows.filter((row) => finite(row[0]) && finite(row[1]) && finite(row[2])) : [];
  if (rosnerRows.length) {
    const data = xyData(rosnerRows.map((row) => row[0] as number), [
      { label: "R", values: rosnerRows.map((row) => row[1] as number) },
      { label: "Critical lambda", values: rosnerRows.map((row) => row[2] as number) },
    ]);
    out.push({ key: "outlier-rosner", name: "Rosner outlier sequence",
      description: "Saved Rosner statistic and critical threshold by test step.", data,
      view: view("Rosner outlier sequence", "Step", "Statistic", null, [0, 1]), mark: "line" });
  }
  return out;
}

/** Pure, bounded adapters from durable result tables to frozen figure drafts.
 * They never consult live source data, so the plotted numbers are exactly the
 * saved analysis output and remain reproducible when the source later moves. */
export function statisticalResultFigureDrafts(result: AnalysisResult): StatisticalResultFigureDraft[] {
  if (!result.tables?.length) return [];
  const drafts = result.producer.id === "distribution-analysis" ? distributionFigures(result)
    : result.producer.id === "fit-y-by-x" ? fitYByXFigures(result)
    : result.producer.id === "multivariate-analysis" ? multivariateFigures(result)
    : result.producer.id === "variability-analysis" ? variabilityFigures(result)
    : result.producer.id === "outlier-screening" ? outlierFigures(result)
    : [];
  return drafts.map((draft) => ({ ...draft, data: { ...draft.data, metadata: {
    ...draft.data.metadata,
    analysisResultId: result.id,
    analysisProducer: result.producer.id,
    analysisFigureKey: draft.key,
  } } }));
}
