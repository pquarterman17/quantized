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
// (1, 2, …), the "sample" axis.

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
export function batchSummaryData(rows: readonly AnalysisBatchRow[], columns: readonly string[], model: string): DataStruct {
  const n = (v: string | number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN);
  return {
    time: rows.map((_, i) => i + 1),
    values: rows.map((r) => columns.map((_, k) => n(r.values[k]))),
    labels: [...columns],
    units: columns.map(() => ""),
    metadata: {
      source: "curve-fit-batch",
      x_column_name: "Input",
      curveFitBatch: { model, sources: rows.map((r) => ({ id: r.datasetId, name: r.name })), createdAt: new Date().toISOString() },
      text_columns: {
        Worksheet: rows.map((r) => r.name),
        Status: rows.map((r) => r.status[0]!.toUpperCase() + r.status.slice(1)),
        Warnings: rows.map((r) => r.warning ?? ""),
      },
    },
  };
}
