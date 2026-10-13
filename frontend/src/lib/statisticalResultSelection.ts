import { groupLevelLabel } from "./categorical";
import { distributionRecipe } from "./distributionAnalysisResult";
import { fitYByXRecipe } from "./fitYByXAnalysisResult";
import type { AnalysisResult, AnalysisResultTable } from "./analysisResult";
import type { Dataset } from "./types";
import { variabilityRecipe } from "./variabilityAnalysisResult";
import { analysisRowIds } from "./rowstate";

export interface StatisticalRowSelection {
  rows: number[];
  label: string;
}

function valueAt(source: Dataset, column: number, row: number): number {
  return column < 0 ? source.data.time[row] : source.data.values[row]?.[column];
}

function sourceCandidates(source: Dataset): number[] {
  return analysisRowIds(source) ?? Array.from({ length: source.data.time.length }, (_, row) => row);
}

function rowsMatching(source: Dataset, candidates: readonly number[], terms: readonly [number, unknown][]): number[] {
  const rows: number[] = [];
  for (const row of candidates) {
    const match = terms.every(([column, wanted]) => {
      const value = valueAt(source, column, row);
      return Number.isFinite(value) && groupLevelLabel(source.data, column, value) === String(wanted);
    });
    if (match) rows.push(row);
  }
  return rows;
}

function directSourceRow(result: AnalysisResult, source: Dataset, table: AnalysisResultTable, row: number): number[] | null {
  if (result.producer.id !== "outlier-screening" && result.producer.id !== "multivariate-analysis") return null;
  const column = table.columns.findIndex((name) => name.toLowerCase() === "source row");
  if (column < 0) return null;
  const saved = table.rows[row]?.[column];
  if (typeof saved !== "number" || !Number.isInteger(saved)) return [];
  const index = result.producer.id === "multivariate-analysis" ? saved - 1 : saved;
  return index >= 0 && index < source.data.time.length ? [index] : [];
}

/** Resolve one saved aggregate/detail row back to the exact source rows that
 * produced it. Returns null when a table has no durable row relationship and
 * [] when it claims one but the saved reference no longer resolves. */
export function statisticalResultRowSelection(
  result: AnalysisResult,
  source: Dataset,
  tableIndex: number,
  rowIndex: number,
  candidates = sourceCandidates(source),
): StatisticalRowSelection | null {
  const table = result.tables?.[tableIndex];
  const row = table?.rows[rowIndex];
  if (!table || !row) return null;

  const direct = directSourceRow(result, source, table, rowIndex);
  if (direct !== null) return { rows: direct, label: direct.length ? "Highlight source row" : "Source row unavailable" };

  const distribution = distributionRecipe(result, source);
  if (distribution?.byCol != null && table.title?.startsWith("Summary by ")) {
    const rows = rowsMatching(source, candidates, [[distribution.byCol, row[0]]]);
    return { rows, label: `Highlight ${rows.length} source row${rows.length === 1 ? "" : "s"}` };
  }

  const fit = fitYByXRecipe(result, source);
  if (fit && table.title === "Group summaries") {
    const terms: [number, unknown][] = [[fit.xCol, row[1]]];
    if (fit.byCol != null && row[0] !== "All") terms.push([fit.byCol, row[0]]);
    const rows = rowsMatching(source, candidates, terms);
    return { rows, label: `Highlight ${rows.length} source row${rows.length === 1 ? "" : "s"}` };
  }

  const variability = variabilityRecipe(result, source);
  if (variability && (table.title === "Cell summaries" || table.title === "Factor A summaries")) {
    const terms: [number, unknown][] = [[variability.factorACol, row[0]]];
    if (table.title === "Cell summaries") terms.push([variability.factorBCol, row[1]]);
    const rows = rowsMatching(source, candidates, terms);
    return { rows, label: `Highlight ${rows.length} source row${rows.length === 1 ? "" : "s"}` };
  }

  return null;
}

/** Batch form for rendering a table: derive the active source-row universe
 * once rather than rebuilding exclusion/filter state for every visible row. */
export function statisticalResultTableSelections(
  result: AnalysisResult, source: Dataset, tableIndex: number, visibleRows: number,
): (StatisticalRowSelection | null)[] {
  const candidates = sourceCandidates(source);
  return Array.from({ length: visibleRows }, (_, row) =>
    statisticalResultRowSelection(result, source, tableIndex, row, candidates));
}
