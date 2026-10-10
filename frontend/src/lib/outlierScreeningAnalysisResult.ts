import type { OutlierDixonResult, OutlierGrubbsResult, OutlierMadResult, OutlierRosnerResult } from "./api";
import { ANALYSIS_RESULT_VERSION, INLINE_TABLE_LIMITS, type AnalysisResult, type AnalysisResultTable } from "./analysisResult";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import type { Dataset } from "./types";

export type OutlierScreeningMethod = "grubbs" | "rosner" | "dixon-q" | "mad";

export interface OutlierScreeningRecipe {
  col: number;
  method: OutlierScreeningMethod;
  alpha: number;
  k: number;
  threshold: number;
}

export type OutlierScreeningResult =
  | { method: "grubbs"; data: OutlierGrubbsResult }
  | { method: "rosner"; data: OutlierRosnerResult }
  | { method: "dixon-q"; data: OutlierDixonResult }
  | { method: "mad"; data: OutlierMadResult };

export interface OutlierSnapshotRow { rowIndex: number; value: number; score: number | null }
export interface OutlierRosnerStep {
  step: number; statistic: number; critical: number; rowIndex: number | null; value: number; exceeds: boolean;
}
export interface OutlierScreeningSnapshot {
  channelLabel: string;
  result: OutlierScreeningResult;
  flaggedRows: OutlierSnapshotRow[];
  omittedRows: number[];
  rosnerSteps: OutlierRosnerStep[];
}

const METHODS = new Set<OutlierScreeningMethod>(["grubbs", "rosner", "dixon-q", "mad"]);
const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function outlierScreeningRecipe(result: AnalysisResult, source?: Dataset): OutlierScreeningRecipe | null {
  if (result.producer.id !== "outlier-screening") return null;
  const recipe = object(object(result.parameters)?.recipe);
  if (!recipe || !Number.isInteger(recipe.col) || (recipe.col as number) < -1 ||
      !METHODS.has(recipe.method as OutlierScreeningMethod) ||
      typeof recipe.alpha !== "number" || !Number.isFinite(recipe.alpha) || recipe.alpha <= 0 || recipe.alpha >= 1 ||
      !Number.isInteger(recipe.k) || (recipe.k as number) < 1 ||
      typeof recipe.threshold !== "number" || !Number.isFinite(recipe.threshold) || recipe.threshold <= 0) return null;
  if (source && (recipe.col as number) >= source.data.labels.length) return null;
  return recipe as unknown as OutlierScreeningRecipe;
}

export function sameOutlierScreeningQuestion(a: OutlierScreeningRecipe, b: OutlierScreeningRecipe): boolean {
  if (a.col !== b.col || a.method !== b.method) return false;
  if (a.method === "mad") return a.threshold === b.threshold;
  if (a.alpha !== b.alpha) return false;
  return a.method !== "rosner" || a.k === b.k;
}

const finite = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function bounded(table: AnalysisResultTable): { table: AnalysisResultTable; warning?: string } {
  const rows = Math.min(table.rows.length, INLINE_TABLE_LIMITS.rows,
    table.columns.length ? Math.floor(INLINE_TABLE_LIMITS.cells / table.columns.length) : 0);
  return {
    table: { ...table, rows: table.rows.slice(0, rows) },
    ...(rows < table.rows.length ? { warning: `"${table.title}" was saved with ${rows} of ${table.rows.length} rows.` } : {}),
  };
}

function resultDetails(snapshot: OutlierScreeningSnapshot): {
  values: Record<string, string | number | null>; interpretation: string;
} {
  const { result } = snapshot;
  if (result.method === "grubbs") return {
    values: { G: finite(result.data.G), "Critical G": finite(result.data.G_critical), Tail: result.data.tail, Alpha: finite(result.data.alpha) },
    interpretation: result.data.flagged ? "One row was flagged by Grubbs' test." : "No row was flagged by Grubbs' test.",
  };
  if (result.method === "dixon-q") return {
    values: { Q: finite(result.data.Q), "Critical Q": finite(result.data.Q_critical), Ratio: result.data.ratio, Tail: result.data.tail, Alpha: finite(result.data.alpha) },
    interpretation: result.data.flagged ? "One row was flagged by Dixon's Q test." : "No row was flagged by Dixon's Q test.",
  };
  if (result.method === "rosner") return {
    values: { Alpha: finite(result.data.alpha), "Maximum outliers tested": result.data.k },
    interpretation: `${result.data.num_outliers} of up to ${result.data.k} candidate rows exceeded the critical lambda.`,
  };
  return {
    values: { Median: finite(result.data.median), MAD: finite(result.data.mad), "Scale method": result.data.scale_method, Threshold: finite(result.data.threshold) },
    interpretation: `${snapshot.flaggedRows.length} row${snapshot.flaggedRows.length === 1 ? " was" : "s were"} flagged by the modified z-score threshold.`,
  };
}

function rowList(rows: readonly number[]): string {
  const shown = rows.slice(0, 20).join(", ");
  return rows.length > 20 ? `${shown}, … (${rows.length - 20} more)` : shown;
}

export function outlierScreeningAnalysisResult(
  id: string, source: Dataset, recipe: OutlierScreeningRecipe, snapshot: OutlierScreeningSnapshot,
  createdAt = new Date().toISOString(),
): AnalysisResult {
  const details = resultDetails(snapshot);
  const flagged = bounded({
    title: "Flagged rows", columns: ["source row", "value", "statistic"],
    rows: snapshot.flaggedRows.map((row) => [row.rowIndex, finite(row.value), finite(row.score)]),
  });
  const rosner = snapshot.rosnerSteps.length ? bounded({
    title: "Rosner sequence", columns: ["step", "R", "critical lambda", "source row", "value", "exceeds"],
    rows: snapshot.rosnerSteps.map((row) => [row.step, finite(row.statistic), finite(row.critical), row.rowIndex, finite(row.value), row.exceeds ? "yes" : "no"]),
  }) : null;
  const methodLabel = snapshot.result.data.method;
  return {
    version: ANALYSIS_RESULT_VERSION, id,
    name: `${snapshot.channelLabel} · ${recipe.method === "mad" ? "MAD outlier screening" : methodLabel} · ${source.name}`,
    producer: { id: "outlier-screening", label: "Outlier screening", version: 1 },
    sources: [{ datasetId: source.id, role: "input" }], outputs: [],
    selection: {
      datasetId: source.id,
      channels: recipe.col < 0 ? [] : [{ index: recipe.col, label: snapshot.channelLabel, unit: source.data.units[recipe.col] ?? "" }],
    },
    sourceFingerprint: analysisDataFingerprint(source),
    scalarValues: {
      Test: methodLabel, Interpretation: details.interpretation, Channel: snapshot.channelLabel,
      N: snapshot.result.data.N, "Flagged rows": snapshot.flaggedRows.length,
      "Non-finite rows omitted": snapshot.omittedRows.length, ...details.values,
    },
    parameters: { recipe: { ...recipe } }, tables: [flagged.table, ...(rosner ? [rosner.table] : [])],
    warnings: [
      "Screening only: no rows were excluded or deleted.",
      ...(snapshot.omittedRows.length ? [`${snapshot.omittedRows.length} non-finite source row${snapshot.omittedRows.length === 1 ? " was" : "s were"} omitted from the test: ${rowList(snapshot.omittedRows)}.`] : []),
      ...[flagged.warning, rosner?.warning].filter((value): value is string => !!value),
    ],
    createdAt,
  };
}
