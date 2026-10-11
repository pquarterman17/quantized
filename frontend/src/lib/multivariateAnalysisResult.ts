import type { CorrelationResponse, PCAResponse } from "./api";
import { ANALYSIS_RESULT_VERSION, INLINE_TABLE_LIMITS, type AnalysisResult, type AnalysisResultTable } from "./analysisResult";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import { fmtNum } from "./format";
import type { Dataset } from "./types";

export type MultivariateCorrelationMethod = "pearson" | "spearman";

export interface MultivariateRecipe {
  columns: number[];
  method: MultivariateCorrelationMethod;
  standardize: boolean;
  pcX: number;
  pcY: number;
}

export interface MultivariateSnapshot {
  labels: string[];
  sourceRows: number[];
  inputRows: number;
  correlation: CorrelationResponse;
  pca: PCAResponse;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function multivariateRecipe(result: AnalysisResult, source?: Dataset): MultivariateRecipe | null {
  if (result.producer.id !== "multivariate-analysis") return null;
  const recipe = record(record(result.parameters)?.recipe);
  if (!recipe || !Array.isArray(recipe.columns) || recipe.columns.length < 2 ||
      !recipe.columns.every((value) => Number.isInteger(value) && value >= -1) ||
      new Set(recipe.columns).size !== recipe.columns.length ||
      (recipe.method !== "pearson" && recipe.method !== "spearman") ||
      typeof recipe.standardize !== "boolean" || !Number.isInteger(recipe.pcX) || !Number.isInteger(recipe.pcY) ||
      (recipe.pcX as number) < 0 || (recipe.pcY as number) < 0 ||
      (recipe.pcX as number) >= recipe.columns.length || (recipe.pcY as number) >= recipe.columns.length) return null;
  const columns = recipe.columns as number[];
  if (source && columns.some((value) => value >= source.data.labels.length)) return null;
  return {
    columns: [...columns], method: recipe.method,
    standardize: recipe.standardize, pcX: recipe.pcX as number, pcY: recipe.pcY as number,
  };
}

export function sameMultivariateQuestion(a: MultivariateRecipe, b: MultivariateRecipe): boolean {
  // The displayed score axes are a view choice, not a different analysis.
  return a.method === b.method && a.standardize === b.standardize &&
    a.columns.length === b.columns.length && a.columns.every((column, index) => column === b.columns[index]);
}

/** Fail closed before a durable save if independently returned correlation
 * and PCA payloads do not describe the same current question. Values may be
 * non-finite for degenerate variables (they are saved as null), but every
 * axis and row must still have the expected shape. */
export function multivariateSnapshotMatchesRecipe(
  recipe: MultivariateRecipe, snapshot: MultivariateSnapshot,
): boolean {
  const p = snapshot.labels.length;
  const k = snapshot.pca.explained.length;
  const matrixIs = (matrix: readonly (readonly unknown[])[]) =>
    matrix.length === p && matrix.every((row) => row.length === p);
  const recipeValid = recipe.columns.length >= 2 && new Set(recipe.columns).size === recipe.columns.length &&
    recipe.columns.every((column) => Number.isInteger(column) && column >= -1) &&
    (recipe.method === "pearson" || recipe.method === "spearman") && typeof recipe.standardize === "boolean" &&
    Number.isInteger(recipe.pcX) && Number.isInteger(recipe.pcY) && recipe.pcX >= 0 && recipe.pcY >= 0;
  return recipeValid && p === recipe.columns.length && Number.isInteger(snapshot.inputRows) &&
    snapshot.inputRows >= snapshot.sourceRows.length &&
    snapshot.sourceRows.every((row) => Number.isInteger(row) && row >= 1) &&
    new Set(snapshot.sourceRows).size === snapshot.sourceRows.length &&
    snapshot.correlation.method === recipe.method && snapshot.correlation.N === snapshot.sourceRows.length &&
    matrixIs(snapshot.correlation.r) && matrixIs(snapshot.correlation.p) &&
    k >= 1 && k <= p && recipe.pcX < k && recipe.pcY < k &&
    snapshot.pca.latent.length === k && snapshot.pca.cumulative.length === k && snapshot.pca.singular.length === k &&
    snapshot.pca.coeff.length === p && snapshot.pca.coeff.every((row) => row.length === k) &&
    snapshot.pca.mu.length === p && snapshot.pca.sigma.length === p &&
    snapshot.pca.score.length === snapshot.sourceRows.length && snapshot.pca.score.every((row) => row.length === k);
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value + 0 : null;
}

function constantVariables(source: Dataset, recipe: MultivariateRecipe, snapshot: MultivariateSnapshot): string[] {
  return recipe.columns.flatMap((column, index) => {
    const values = snapshot.sourceRows.map((row) => column < 0
      ? source.data.time[row - 1]
      : source.data.values[row - 1]?.[column]).filter((value): value is number => Number.isFinite(value));
    return values.length > 0 && values.every((value) => value === values[0]) ? [snapshot.labels[index]] : [];
  });
}

interface TableSource {
  title: string;
  columns: string[];
  rowCount: number;
  row: (index: number) => AnalysisResultTable["rows"][number];
}

function matrixTable(title: string, labels: readonly string[], matrix: readonly (readonly (number | null)[])[]): TableSource {
  return { title, columns: ["variable", ...labels], rowCount: labels.length,
    row: (row) => [labels[row], ...labels.map((_, column) => finite(matrix[row]?.[column]))] };
}

function outputTables(snapshot: MultivariateSnapshot): TableSource[] {
  const componentCount = snapshot.pca.explained.length;
  const pcLabels = Array.from({ length: componentCount }, (_, index) => `PC${index + 1}`);
  return [
    matrixTable("Correlation coefficients", snapshot.labels, snapshot.correlation.r),
    matrixTable("Correlation p-values", snapshot.labels, snapshot.correlation.p),
    {
      title: "PCA component summary",
      columns: ["component", "eigenvalue", "explained %", "cumulative %", "singular value"],
      rowCount: pcLabels.length,
      row: (index) => [pcLabels[index], finite(snapshot.pca.latent[index]), finite(snapshot.pca.explained[index]),
        finite(snapshot.pca.cumulative[index]), finite(snapshot.pca.singular[index])],
    },
    {
      title: "PCA loadings", columns: ["variable", ...pcLabels],
      rowCount: snapshot.labels.length,
      row: (row) => [snapshot.labels[row], ...pcLabels.map((_, column) => finite(snapshot.pca.coeff[row]?.[column]))],
    },
    {
      title: "PCA centering and scaling", columns: ["variable", "mean", "scale"],
      rowCount: snapshot.labels.length,
      row: (index) => [snapshot.labels[index], finite(snapshot.pca.mu[index]), finite(snapshot.pca.sigma[index])],
    },
    {
      title: "PCA scores", columns: ["source row", ...pcLabels],
      rowCount: snapshot.pca.score.length,
      row: (index) => [snapshot.sourceRows[index] ?? index + 1,
        ...pcLabels.map((_, column) => finite(snapshot.pca.score[index]?.[column]))],
    },
  ];
}

function boundedTables(input: TableSource[]): { tables: AnalysisResultTable[]; warnings: string[] } {
  const tables: AnalysisResultTable[] = [];
  const warnings: string[] = [];
  let cells = 0;
  input.forEach((table, index) => {
    const name = table.title ? `"${table.title}"` : `Table ${index + 1}`;
    if (tables.length >= INLINE_TABLE_LIMITS.tables || table.columns.length > INLINE_TABLE_LIMITS.columns) {
      warnings.push(`${name} was too wide to save and was omitted.`);
      return;
    }
    const remaining = Math.max(0, INLINE_TABLE_LIMITS.cells - cells);
    const fit = Math.min(table.rowCount, INLINE_TABLE_LIMITS.rows,
      table.columns.length ? Math.floor(remaining / table.columns.length) : 0);
    if (fit < table.rowCount) warnings.push(`${name} was saved with ${fit} of ${table.rowCount} rows.`);
    cells += fit * table.columns.length;
    tables.push({ title: table.title, columns: table.columns, rows: Array.from({ length: fit }, (_, row) => table.row(row)) });
  });
  return { tables, warnings };
}

export function multivariateAnalysisResult(
  id: string,
  source: Dataset,
  recipe: MultivariateRecipe,
  snapshot: MultivariateSnapshot,
  createdAt = new Date().toISOString(),
): AnalysisResult {
  const bounded = boundedTables(outputTables(snapshot));
  const n = Math.min(snapshot.sourceRows.length, snapshot.correlation.N, snapshot.pca.score.length);
  const omitted = Math.max(0, snapshot.inputRows - n);
  const explained = finite(snapshot.pca.explained[0]);
  const constants = constantVariables(source, recipe, snapshot);
  const undefinedCorrelations = snapshot.correlation.r.some((row) => row.some(
    (value) => typeof value !== "number" || !Number.isFinite(value),
  ));
  const warnings = [
    ...(omitted ? [`${omitted} row${omitted === 1 ? " was" : "s were"} omitted by listwise deletion.`] : []),
    ...(constants.length ? [`Constant variable${constants.length === 1 ? "" : "s"}: ${constants.join(", ")}. Correlations involving ${constants.length === 1 ? "it are" : "them are"} undefined.${recipe.standardize ? " PCA records a scale of 1 as a zero-variance fallback." : ""}`] : []),
    ...(!constants.length && undefinedCorrelations ? ["Undefined correlations were saved as null."] : []),
    ...(snapshot.correlation.N !== snapshot.sourceRows.length || snapshot.pca.score.length !== snapshot.sourceRows.length
      ? ["The returned correlation/PCA row counts differ from the shared listwise-complete input."] : []),
    ...bounded.warnings,
  ];
  const variableSummary = snapshot.labels.length <= 12 ? snapshot.labels.join(", ")
    : `${snapshot.labels.slice(0, 12).join(", ")}, and ${snapshot.labels.length - 12} more`;
  return {
    version: ANALYSIS_RESULT_VERSION,
    id,
    name: `Multivariate (${snapshot.labels.length} variables) · ${source.name}`,
    producer: { id: "multivariate-analysis", label: "Multivariate", version: 1 },
    sources: [{ datasetId: source.id, role: "input" }], outputs: [],
    selection: {
      datasetId: source.id,
      channels: recipe.columns.filter((index) => index >= 0).map((index) => ({
        index, label: source.data.labels[index] ?? `column ${index + 1}`, unit: source.data.units[index] ?? "",
      })),
    },
    sourceFingerprint: analysisDataFingerprint(source),
    scalarValues: {
      Test: "Multivariate", Interpretation: `${n} listwise-complete rows across ${snapshot.labels.length} variables${explained === null ? "." : `; PC1 explains ${fmtNum(explained)}%.`}`,
      Variables: variableSummary, N: n, "Input rows": snapshot.inputRows,
      "Rows omitted by listwise deletion": omitted, Correlation: recipe.method,
      "Correlation p-values": "two-sided t approximation",
      "PCA standardized": recipe.standardize ? "yes" : "no",
      "PCA loading signs": "largest-magnitude loading positive",
      "Displayed score axes": `PC${recipe.pcX + 1} / PC${recipe.pcY + 1}`,
    },
    parameters: { recipe: { ...recipe, columns: [...recipe.columns] } },
    tables: bounded.tables, warnings, createdAt,
  };
}
