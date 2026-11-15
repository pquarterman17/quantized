// Curve Fit batch — the per-worksheet summary row and the summary WORKSHEET
// (pure). Origin's batch fit lands a summary sheet with one row per input
// and a column per parameter (plus its standard error) and per statistic, so
// a parameter can be plotted against the sample; this is that sheet.
//
// Columns (after the batch shell's Worksheet / Status / Rows): Levels,
// Completed, N, R², Reduced χ², RMSE, then each parameter and its SE. Numbers
// stay numbers (missing = NaN in the worksheet); Worksheet, Status and
// Warnings become read-only text columns (`metadata.text_columns`, the
// convention lib/columnmeta's worksheet reads). X is the input's position
// (1, 2, …) unless the caller passes a `SummaryXResult` (lib/batchSummaryX:
// a metadata field, a user parameter or a number in the name), so a
// parameter plots against temperature or field; blank where an input has no
// value for it, never a guess.

import { inOrder, summaryXMeta, type SummaryXResult } from "../../../lib/batchSummaryX";
import type { CalcResult, DataStruct } from "../../../lib/types";
import type { AnalysisBatchRow } from "../analysisselection/AnalysisBatchControls";

/** The tool's summary columns for a model with `names` parameters. */
export function batchColumns(names: readonly string[]): string[] {
  return ["Levels", "Completed", "N", "R²", "Reduced χ²", "RMSE", ...names.flatMap((n) => [n, `${n} SE`])];
}

const fin = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** N, R², reduced χ², RMSE, then value/SE per parameter, from one fit result. */
export function fitSummaryValues(r: CalcResult, nParams: number): (number | null)[] {
  const params = Array.isArray(r.params) ? (r.params as unknown[]) : [];
  const errors = Array.isArray(r.errors) ? (r.errors as unknown[]) : [];
  const out: (number | null)[] = [fin(r.nPoints), fin(r.R2), fin(r.chiSqRed), fin(r.RMSE)];
  for (let k = 0; k < nParams; k++) out.push(fin(params[k]), fin(errors[k]));
  return out;
}

/** The summary worksheet for a finished batch (every input, failed ones as NaN rows). */
export function batchSummaryData(
  inputRows: readonly AnalysisBatchRow[], columns: readonly string[], model: string, x?: SummaryXResult,
): DataStruct {
  const rows = x ? inOrder(inputRows, x) : inputRows;
  const n = (v: string | number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN);
  return {
    time: x ? x.x : rows.map((_, i) => i + 1),
    values: rows.map((r) => columns.map((_, k) => n(r.values[k]))),
    labels: [...columns],
    units: columns.map(() => ""),
    metadata: {
      source: "curve-fit-batch",
      x_column_name: "Input",
      ...(x ? summaryXMeta(x) : {}),
      curveFitBatch: { model, sources: rows.map((r) => ({ id: r.datasetId, name: r.name })), createdAt: new Date().toISOString() },
      text_columns: {
        Worksheet: rows.map((r) => r.name),
        Status: rows.map((r) => r.status[0]!.toUpperCase() + r.status.slice(1)),
        Warnings: rows.map((r) => r.warning ?? ""),
      },
    },
  };
}

/** `rows` in Library order, not run order: the batch starts with the active
 *  worksheet, so the run order is not the samples' order. */
export function libraryOrder(rows: readonly AnalysisBatchRow[], datasetIds: readonly string[]): AnalysisBatchRow[] {
  const position = new Map(datasetIds.map((id, i) => [id, i]));
  return [...rows].sort((a, b) => (position.get(a.datasetId) ?? Infinity) - (position.get(b.datasetId) ?? Infinity));
}

/** The graph results table's inputs from the summary's row values (Levels,
 *  Completed, N, R², reduced χ², RMSE, then value and SE per parameter). A
 *  failed input keeps its row, with no numbers. */
export function batchTableInputs(rows: readonly AnalysisBatchRow[], nParams: number) {
  return rows.map((r) => ({
    name: r.name,
    params: Array.from({ length: nParams }, (_, j) => r.values[6 + 2 * j]),
    errors: Array.from({ length: nParams }, (_, j) => r.values[7 + 2 * j]),
    R2: r.values[3],
    chiSqRed: r.values[4],
  }));
}
