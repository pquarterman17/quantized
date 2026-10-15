import type { AnalysisResult, AnalysisResultTable } from "./analysisResult";
import type { ErrorBinding } from "./errorRoles";
import type { PlotMark } from "./plotMarks";
import { defaultPlotView, type PlotView } from "./plotview";
import type { DataStruct } from "./types";
import type { StatisticalFigureLinkDescriptor } from "./statisticalFigureLinkTypes";
import { hysteresisBatchResultFigures } from "./hysteresisTrend";
import { williamsonHallBatchResultFigures, williamsonHallResultFigure } from "./williamsonHallResultFigure";

export interface StatisticalResultFigureDraft {
  key: string;
  name: string;
  description: string;
  data: DataStruct;
  view: PlotView;
  mark: PlotMark;
  errors?: ErrorBinding[];
  sourceLink?: StatisticalFigureLinkDescriptor;
}

const table = (result: AnalysisResult, title: string): AnalysisResultTable | undefined =>
  result.tables?.find((candidate) => candidate.title === title);

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown): string => typeof value === "string" ? value : String(value ?? "");
const columnsAre = (source: AnalysisResultTable, expected: readonly string[]): boolean =>
  source.columns.length === expected.length && expected.every((label, index) => source.columns[index] === label);

function recipeColumn(result: AnalysisResult, key: string): number | null {
  const recipe = result.parameters?.recipe;
  if (typeof recipe !== "object" || recipe === null || Array.isArray(recipe)) return null;
  const value = recipe[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function recipeByColumn(result: AnalysisResult): number | null | undefined {
  const recipe = result.parameters?.recipe;
  if (typeof recipe !== "object" || recipe === null || Array.isArray(recipe)) return undefined;
  const value = recipe.byCol;
  return value === null ? null
    : typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function selectedUnit(result: AnalysisResult, recipeKey: string, label: string): string {
  const index = recipeColumn(result, recipeKey);
  return result.selection?.channels.find((channel) => index !== null && channel.index === index)?.unit ??
    result.selection?.channels.find((channel) => channel.label === label)?.unit ?? "";
}

const withUnit = (label: string, unit: string): string => unit ? `${label} (${unit})` : label;

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
  const xLabel = withUnit(column, selectedUnit(result, "col", column));
  return (result.tables ?? []).flatMap((candidate, index) => {
    if (!(candidate.title === "Histogram" || candidate.title?.startsWith("Histogram · ")) ||
        !columnsAre(candidate, ["bin left", "center", "bin right", "count"])) return [];
    const rows = candidate.rows.filter((row) => finite(row[1]) && finite(row[3]));
    if (!rows.length) return [];
    const grouped = candidate.title !== "Histogram";
    const level = grouped ? candidate.title!.slice("Histogram · ".length) : "";
    const name = `${column} distribution${grouped ? ` · ${level || "(blank)"}` : ""}`;
    const data = xyData(rows.map((row) => row[1] as number), [{ label: "Count", values: rows.map((row) => row[3] as number) }]);
    const responseColumn = recipeColumn(result, "col");
    const byColumn = recipeByColumn(result);
    const linkScopeValid = grouped ? typeof byColumn === "number" : byColumn === null;
    return [{
      key: `distribution-histogram-${index}`,
      name,
      description: `Histogram saved with this result${grouped ? ` for ${level || "(blank)"}` : ""}.`,
      data,
      view: view(name, xLabel, "Count", null, [0]),
      mark: "bar",
      ...(responseColumn === null || !linkScopeValid ? {} : { sourceLink: {
        kind: "histogram" as const,
        responseColumn,
        ...(grouped && typeof byColumn === "number" ? { level: { column: byColumn, label: level } } : {}),
        bins: rows.map((row): [number, number] => [row[0] as number, row[2] as number]),
      } }),
    }];
  });
}

function onewayFigures(result: AnalysisResult, source: AnalysisResultTable): StatisticalResultFigureDraft[] {
  if (!columnsAre(source, ["level", "group", "N", "mean", "sd"])) return [];
  const levels = [...new Set(source.rows.map((row) => text(row[0])))];
  const yName = text(result.scalarValues?.["Y column"]) || "Mean";
  const yUnit = selectedUnit(result, "yCol", yName);
  const yLabel = withUnit(yName, yUnit);
  const xColumn = recipeColumn(result, "xCol"), yColumn = recipeColumn(result, "yCol");
  const byColumn = recipeByColumn(result);
  return levels.flatMap((level, index) => {
    const rows = source.rows.filter((row) => text(row[0]) === level && finite(row[3]));
    if (!rows.length) return [];
    const groups = rows.map((row) => text(row[1]));
    const means = rows.map((row) => row[3] as number);
    const sd = rows.map((row) => finite(row[4]) ? row[4] as number : Number.NaN);
    const hasSd = sd.some(Number.isFinite);
    const data = categoricalData(groups, text(result.scalarValues?.["X column"]) || "Group", [
      { label: yName, values: means, unit: yUnit }, ...(hasSd ? [{ label: `${yName} SD`, values: sd, unit: yUnit }] : []),
    ]);
    const name = `${yName} by group${typeof byColumn === "number" || level !== "All" ? ` · ${level}` : ""}`;
    return [{
      key: `fit-y-by-x-oneway-${index}`,
      name,
      description: hasSd ? "Saved group means with standard-deviation error bars." : "Saved group means; standard deviation was unavailable.",
      data,
      view: view(name, data.labels[0], yLabel, 0, [1]),
      mark: "bar",
      ...(hasSd ? { errors: [{ channel: 2, target: 1, axis: "y", side: "both" } as const] } : {}),
      ...(xColumn === null || yColumn === null || byColumn === undefined ||
        (level !== "All" && byColumn === null) ? {} : { sourceLink: {
        kind: "match" as const, responseColumn: yColumn,
        rows: rows.map((row) => ({
          levels: [[xColumn, text(row[1])] as [number, string],
            ...(typeof byColumn === "number" ? [[byColumn, level] as [number, string]] : [])],
        })),
      } }),
    }];
  });
}

function bivariateFigures(result: AnalysisResult, source: AnalysisResultTable): StatisticalResultFigureDraft[] {
  if (!columnsAre(source, ["level", "X", "fitted Y"])) return [];
  const levels = [...new Set(source.rows.map((row) => text(row[0])))];
  const xName = text(result.scalarValues?.["X column"]) || "X";
  const yName = text(result.scalarValues?.["Y column"]) || "Fitted Y";
  const xLabel = withUnit(xName, selectedUnit(result, "xCol", xName));
  const yUnit = selectedUnit(result, "yCol", yName);
  const yLabel = withUnit(yName, yUnit);
  const yColumn = recipeColumn(result, "yCol");
  const byColumn = recipeByColumn(result);
  return levels.flatMap((level, index) => {
    const rows = source.rows.filter((row) => text(row[0]) === level && finite(row[1]) && finite(row[2]));
    if (!rows.length) return [];
    const name = `${yName} fitted curve${typeof byColumn === "number" || level !== "All" ? ` · ${level}` : ""}`;
    const data = xyData(rows.map((row) => row[1] as number), [{ label: "Fitted Y", values: rows.map((row) => row[2] as number), unit: yUnit }]);
    return [{ key: `fit-y-by-x-curve-${index}`, name,
      description: "Fitted curve saved with this result. Observations remain in the source worksheet.",
      data, view: view(name, xLabel, yLabel, null, [0]), mark: "line",
      ...(yColumn === null || byColumn === undefined ||
        (level !== "All" && byColumn === null) ? {} : { sourceLink: {
        kind: "match" as const, responseColumn: yColumn,
        rows: rows.map(() => ({
          levels: typeof byColumn === "number" ? [[byColumn, level] as [number, string]] : [],
          // These are synthetic fit-grid points, not observations. Every
          // point represents the complete fit group; exact X matching would
          // falsely select only observations that happen to land on the grid.
        })),
      } }) }];
  });
}

function regressionBandFigures(
  result: AnalysisResult,
  source: AnalysisResultTable,
  fittedSource?: AnalysisResultTable,
): StatisticalResultFigureDraft[] {
  if (!columnsAre(source, ["level", "X", "lower", "upper", "alpha"])) return [];
  const levels = [...new Set(source.rows.map((row) => text(row[0])))];
  const xName = text(result.scalarValues?.["X column"]) || "X";
  const yName = text(result.scalarValues?.["Y column"]) || "Y";
  const xLabel = withUnit(xName, selectedUnit(result, "xCol", xName));
  const yUnit = selectedUnit(result, "yCol", yName);
  const yLabel = withUnit(yName, yUnit);
  const savedRecipe = result.parameters?.recipe;
  const recipe = typeof savedRecipe === "object" && savedRecipe !== null && !Array.isArray(savedRecipe) ? savedRecipe : {};
  const interval = recipe.bandInterval === "prediction" || recipe.bandInterval === "confidence"
    ? recipe.bandInterval : null;
  const fittedValid = fittedSource && columnsAre(fittedSource, ["level", "X", "fitted Y"]);
  const yColumn = recipeColumn(result, "yCol");
  const byColumn = recipeByColumn(result);
  return levels.flatMap((level, index) => {
    const rows = source.rows.filter((row) => text(row[0]) === level && finite(row[1]) && finite(row[2]) && finite(row[3]) && finite(row[4]));
    if (!rows.length) return [];
    const firstAlpha = rows[0][4] as number;
    const alpha = rows.every((row) => row[4] === firstAlpha) ? firstAlpha : null;
    const coverage = alpha !== null && alpha >= 0 && alpha <= 1
      ? `${((1 - alpha) * 100).toFixed(1).replace(/\.0$/, "")}% ` : "";
    const x = rows.map((row) => row[1] as number);
    const fitted = fittedValid ? x.map((value) => {
      const match = fittedSource.rows.find((row) => text(row[0]) === level && row[1] === value && finite(row[2]));
      return match ? match[2] as number : Number.NaN;
    }) : [];
    // A FigureDocument uses one shared X grid. Include the saved fitted line
    // only when every band-grid X has an exact saved counterpart; never
    // interpolate or recompute values merely to make the overlay convenient.
    const hasFitted = fitted.length === x.length && fitted.every(Number.isFinite);
    const data = xyData(x, [
      ...(hasFitted ? [{ label: "Fitted Y", values: fitted, unit: yUnit }] : []),
      { label: "Lower bound", values: rows.map((row) => row[2] as number), unit: yUnit },
      { label: "Upper bound", values: rows.map((row) => row[3] as number), unit: yUnit },
    ]);
    const intervalLabel = `${coverage}${interval ? `${interval} interval` : "regression interval"}`;
    const name = `${yName} ${intervalLabel}${typeof byColumn === "number" || level !== "All" ? ` · ${level}` : ""}`;
    return [{ key: `fit-y-by-x-band-${index}`, name,
      description: hasFitted
        ? `Fitted curve plus lower and upper ${intervalLabel} bounds saved with this result.`
        : `Lower and upper ${intervalLabel} bounds saved with this result.`,
      data, view: view(name, xLabel, yLabel, null, data.labels.map((_, series) => series)), mark: "line",
      ...(yColumn === null || byColumn === undefined ||
        (level !== "All" && byColumn === null) ? {} : { sourceLink: {
        kind: "match" as const, responseColumn: yColumn,
        rows: rows.map(() => ({
          levels: typeof byColumn === "number" ? [[byColumn, level] as [number, string]] : [],
        })),
      } }) }];
  });
}

function contingencyFigures(result: AnalysisResult, source: AnalysisResultTable): StatisticalResultFigureDraft[] {
  if (!columnsAre(source, ["level", "row", "column", "observed", "expected"])) return [];
  const levels = [...new Set(source.rows.map((row) => text(row[0])))];
  const xColumn = recipeColumn(result, "xCol"), yColumn = recipeColumn(result, "yCol");
  const byColumn = recipeByColumn(result);
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
    const name = `Observed counts${typeof byColumn === "number" || level !== "All" ? ` · ${level}` : ""}`;
    return [{ key: `fit-y-by-x-contingency-${index}`, name,
      description: "Observed contingency-table counts saved with this result.",
      data, view: view(name, data.labels[0], "Count", 0, series.map((_, i) => i + 1)), mark: "bar",
      ...(xColumn === null || yColumn === null || byColumn === undefined ||
        (level !== "All" && byColumn === null) ? {} : { sourceLink: {
        kind: "match" as const, responseColumn: yColumn,
        rows: rowLevels.map((rowLevel) => ({
          levels: [[xColumn, rowLevel] as [number, string],
            ...(typeof byColumn === "number" ? [[byColumn, level] as [number, string]] : [])],
        })),
      } }) }];
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
    return [...(source ? bivariateFigures(result, source) : []), ...(band ? regressionBandFigures(result, band, source) : [])];
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
    const explained = new Map(componentRows.map((row) => [text(row[0]), row[2] as number]));
    const axisLabel = (label: string) => finite(explained.get(label)) ? `${label} (${explained.get(label)!.toFixed(1)}%)` : label;
    const data = xyData(scoreRows.map((row) => row[xColumn] as number), [
      { label: yLabel, values: scoreRows.map((row) => row[yColumn] as number) },
    ]);
    out.push({ key: "multivariate-scores", name: `PCA scores · ${xLabel} / ${yLabel}`,
      description: "Score coordinates saved with this result; omitted source rows remain omitted.",
      data, view: view(`PCA scores · ${xLabel} / ${yLabel}`, axisLabel(xLabel), axisLabel(yLabel), null, [0]), mark: "scatter",
      sourceLink: { kind: "direct", rows: scoreRows.map((row) => (row[0] as number) - 1) } });
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
    const yName = text(result.scalarValues?.Response) || "Mean";
    const yUnit = selectedUnit(result, "responseCol", yName);
    const yLabel = withUnit(yName, yUnit);
    const responseColumn = recipeColumn(result, "responseCol");
    const factorAColumn = recipeColumn(result, "factorACol"), factorBColumn = recipeColumn(result, "factorBCol");
    const data = categoricalData(labels, `${cells.columns[0]} / ${cells.columns[1]}`, [
      { label: yName, values: means, unit: yUnit }, ...(hasSd ? [{ label: `${yName} SD`, values: sd, unit: yUnit }] : []),
    ]);
    out.push({ key: "variability-cells", name: `${yName} cell means`,
      description: hasSd ? "Saved nested-cell means with standard-deviation error bars." : "Saved nested-cell means; standard deviation was unavailable.", data,
      view: view(`${yLabel} cell means`, data.labels[0], yLabel, 0, [1]), mark: "bar",
      ...(hasSd ? { errors: [{ channel: 2, target: 1, axis: "y", side: "both" } as const] } : {}),
      ...(responseColumn === null || factorAColumn === null || factorBColumn === null ? {} : { sourceLink: {
        kind: "match" as const, responseColumn,
        rows: cellRows.map((row) => ({ levels: [
          [factorAColumn, text(row[0])] as [number, string], [factorBColumn, text(row[1])] as [number, string],
        ] })),
      } }) });
  }
  return out;
}

function outlierFigures(result: AnalysisResult): StatisticalResultFigureDraft[] {
  const out: StatisticalResultFigureDraft[] = [];
  const flagged = table(result, "Flagged rows");
  const flaggedRows = flagged && columnsAre(flagged, ["source row", "value", "statistic"])
    ? flagged.rows.filter((row) => finite(row[0]) && finite(row[1])) : [];
  if (flaggedRows.length) {
    const name = text(result.scalarValues?.Channel) || "Value";
    const unit = selectedUnit(result, "col", name);
    const label = withUnit(name, unit);
    const data = xyData(flaggedRows.map((row) => row[0] as number), [
      { label: name, values: flaggedRows.map((row) => row[1] as number), unit },
    ]);
    out.push({ key: "outlier-flagged", name: `${name} flagged observations`,
      description: "Only observations flagged by the saved screening result are shown.", data,
      view: view(`${label} flagged observations`, "Source row", label, null, [0]), mark: "scatter",
      sourceLink: { kind: "direct", rows: flaggedRows.map((row) =>
        (row[0] as number) - (result.producer.version >= 2 ? 1 : 0)) } });
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
      view: view("Rosner outlier sequence", "Step", "Statistic", null, [0, 1]), mark: "line",
      sourceLink: { kind: "direct", rows: rosnerRows.map((row) => finite(row[3])
        ? (row[3] as number) - (result.producer.version >= 2 ? 1 : 0) : -1) } });
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
    : result.producer.id === "williamson-hall" ? williamsonHallResultFigure(result)
    : result.producer.id === "williamson-hall-batch" ? williamsonHallBatchResultFigures(result)
    : result.producer.id === "analysis-batch" && result.parameters?.toolId === "hysteresis"
      ? hysteresisBatchResultFigures(result)
    : [];
  return drafts.map((draft) => ({ ...draft, data: { ...draft.data, metadata: {
    ...draft.data.metadata,
    analysisResultId: result.id,
    analysisProducer: result.producer.id,
    analysisFigureKey: draft.key,
    ...(draft.sourceLink ? { analysisSourceLink: draft.sourceLink } : {}),
  } } }));
}
