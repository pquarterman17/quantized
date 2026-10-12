import type { AnalysisResult, AnalysisResultTable } from "./analysisResult";
import { snapshotResultState, type SnapshotResultState } from "./analysisResultFreshness";
import type { Dataset } from "./types";

const STATISTICAL_PRODUCERS = new Set([
  "statistical-test",
  "distribution-analysis",
  "fit-y-by-x",
  "variability-analysis",
  "outlier-screening",
  "multivariate-analysis",
]);

export interface StatisticalWorkspaceResult {
  result: AnalysisResult;
  sourceNames: string[];
  state: SnapshotResultState;
  activeSource: boolean;
}

export function isStatisticalResult(result: AnalysisResult): boolean {
  return STATISTICAL_PRODUCERS.has(result.producer.id);
}

function safeTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Filter and rank the statistics inventory without mutating the project's
 * result order. The active worksheet is useful context, but never hides
 * results from other worksheets unless the user explicitly asks it to. */
export function statisticalWorkspaceResults(
  results: readonly AnalysisResult[],
  datasets: readonly Dataset[],
  activeId: string | null,
  query: string,
  currentWorksheetOnly = false,
): StatisticalWorkspaceResult[] {
  const names = new Map(datasets.map((dataset) => [dataset.id, dataset.name]));
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return results
    .filter(isStatisticalResult)
    .map((result) => {
      const sourceNames = result.sources.map((source) => names.get(source.datasetId) ?? "Missing worksheet");
      return {
        result,
        sourceNames,
        state: snapshotResultState(result, datasets),
        activeSource: result.sources.some((source) => source.datasetId === activeId),
      };
    })
    .filter((item) => !currentWorksheetOnly || item.activeSource)
    .filter((item) => terms.every((term) => [
      item.result.name,
      item.result.producer.label,
      ...item.sourceNames,
      typeof item.result.scalarValues?.Interpretation === "string"
        ? item.result.scalarValues.Interpretation
        : "",
      ...item.result.warnings,
    ].join(" ").toLocaleLowerCase().includes(term)))
    .sort((a, b) => Number(b.activeSource) - Number(a.activeSource) ||
      safeTime(b.result.updatedAt ?? b.result.createdAt) - safeTime(a.result.updatedAt ?? a.result.createdAt) ||
      a.result.name.localeCompare(b.result.name));
}

/** Bounded preview data. Saved tables can be much larger than is sensible to
 * mount in an accordion; the full result remains the authority. */
export function statisticalTablePreviews(
  result: AnalysisResult,
  tableLimit = 4,
  rowLimit = 20,
): { table: AnalysisResultTable; tableIndex: number; rows: AnalysisResultTable["rows"] }[] {
  return (result.tables ?? []).slice(0, tableLimit).map((table, tableIndex) => ({
    table,
    tableIndex,
    rows: table.rows.slice(0, rowLimit),
  }));
}
