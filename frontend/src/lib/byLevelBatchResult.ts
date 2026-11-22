// A finished "By" run (one summary row per level of a categorical column) as
// ONE durable analysis-batch result (lane BY). The worksheet batch
// (AnalysisBatchControls) groups one row per worksheet under producer
// "analysis-batch"; a By run is the same shape with one row per LEVEL of one
// worksheet, so it lands in the Library / Result book next to the batches and
// is judged fresh by the same snapshot rule (the source's fingerprint).
//
// Pure: the caller supplies the id, timestamp and fingerprint. Fails closed:
// returns a reason string instead of a result when there is nothing honest to
// record (no levels, a row/column shape mismatch).

import { ANALYSIS_RESULT_VERSION, type AnalysisResult, type AnalysisResultValue } from "./analysisResult";
import { ANALYSIS_SELECTION_VERSION, type AnalysisRangeSelection, analysisSelectionSnapshot } from "./analysisSelection";

export type ByResultCell = string | number | null;

export interface ByResultRow {
  label: string;
  n: number;
  /** One cell per header; ignored when `error` is set. */
  values: readonly ByResultCell[];
  error: string | null;
}

export interface ByLevelBatchInput {
  id: string;
  createdAt: string;
  /** Tool id (the same id its worksheet batch uses) and its display label. */
  toolId: string;
  label: string;
  datasetId: string;
  /** The analysed worksheet's analysis-view fingerprint when the levels ran. */
  sourceFingerprint: string;
  byColumn: { index: number; label: string };
  headers: readonly string[];
  rows: readonly ByResultRow[];
  /** Levels that exist but were not run (the BY_MAX_LEVELS cap). */
  omittedLevels: number;
  /** The tool's own small, JSON-safe settings (provenance only). */
  parameters?: Record<string, AnalysisResultValue>;
  /** The columns the tool analysed on that worksheet (provenance). */
  xKey?: number | null;
  yKeys?: readonly number[];
  /** Row / range restriction of the selection the levels were cut from. */
  rowIds?: readonly number[] | null;
  range?: AnalysisRangeSelection | null;
}

/** The table title the Result book and figure code read for batch results. */
export const BY_STATUS_TABLE = "Batch status";

/** A tool's settings as a result accepts them: non-finite numbers (a blank
 *  bound held as NaN) and undefined fields are omitted, since one of either
 *  makes the whole parameters tree unreadable on reopen. */
function jsonSafe(parameters: Record<string, AnalysisResultValue>): Record<string, AnalysisResultValue> {
  return JSON.parse(JSON.stringify(parameters, (_key, value: unknown) =>
    typeof value === "number" && !Number.isFinite(value) ? undefined : value)) as Record<string, AnalysisResultValue>;
}

export function byLevelBatchResult(input: ByLevelBatchInput): AnalysisResult | string {
  if (input.rows.length === 0) return "No levels have run yet.";
  if (input.rows.some((row) => !row.error && row.values.length !== input.headers.length)) {
    return "A level's summary does not match the table columns.";
  }
  const warnings = input.rows.filter((row) => row.error).map((row) => `${row.label}: ${row.error}`);
  if (input.omittedLevels > 0) {
    warnings.unshift(`${input.omittedLevels} further level${input.omittedLevels === 1 ? " was" : "s were"} not run (level cap).`);
  }
  const selection = analysisSelectionSnapshot({
    version: ANALYSIS_SELECTION_VERSION,
    source: "tool-default",
    createdAt: input.createdAt,
    items: [{
      datasetId: input.datasetId, xKey: input.xKey ?? null, yKeys: [...(input.yKeys ?? [])],
      errorBindings: [], errorKeys: {}, factorKeys: [input.byColumn.index],
      rowIds: input.rowIds ? [...input.rowIds] : null, range: input.range ?? null, roi: null,
    }],
  });
  return {
    version: ANALYSIS_RESULT_VERSION,
    id: input.id,
    name: `${input.label} by ${input.byColumn.label} — ${new Date(input.createdAt).toLocaleString()}`,
    producer: { id: "analysis-batch", label: input.label, version: 1 },
    sources: [{ datasetId: input.datasetId, role: "input" }],
    outputs: [],
    parameters: {
      ...(input.parameters ? jsonSafe(input.parameters) : {}),
      toolId: input.toolId,
      byColumn: input.byColumn.label,
      selection: selection as unknown as AnalysisResultValue,
    },
    tables: [{
      title: BY_STATUS_TABLE,
      columns: ["Level", "Status", "Rows", ...input.headers, "Warnings"],
      rows: input.rows.map((row) => [
        row.label, row.error ? "Failed" : "Completed", row.n,
        ...input.headers.map((_header, index) => (row.error ? null : row.values[index] ?? null)),
        row.error,
      ]),
    }],
    warnings,
    createdAt: input.createdAt,
    sourceFingerprint: input.sourceFingerprint,
  };
}
