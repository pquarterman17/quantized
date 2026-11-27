// "Open as worksheet" on a saved result's table (the result book, acceptance 8 U3). Freezing the same table of the
// same result twice must not add a second identical sheet: the repeat returns the sheet already made, as a repeated
// commit of a computed output does ("already added"). A result saved under a row range carries it onto the frozen
// sheet, in the private metadata key a committed output uses (`stampInputRowRanges`), so the sheet says which rows
// its numbers were computed on.

import type { AnalysisResult, AnalysisResultTable } from "./analysisResult";
import { readRecordedRowRange, ROW_RANGE_PARAM, stampInputRowRanges } from "./inputRowRange";
import type { DataStruct, Dataset } from "./types";

/** The worksheet an earlier freeze of this result's `table` made and that still exists, or undefined. The match is
 *  the recorded provenance (`frozenFrom`: this result, this table title) plus the table's own shape, so two tables
 *  of one result with the same title but different columns or sizes stay two sheets. */
export function frozenTableTwin(result: AnalysisResult, table: AnalysisResultTable, datasets: readonly Dataset[]): Dataset | undefined {
  return datasets.find((dataset) => {
    const from = dataset.data.metadata?.["frozenFrom"] as { resultId?: unknown; table?: unknown } | undefined;
    return from?.resultId === result.id && from.table === (table.title ?? null)
      && dataset.data.time.length === table.rows.length
      && dataset.data.labels.length === table.columns.length && dataset.data.labels.every((label, i) => label === table.columns[i]);
  });
}

/** `data` with the result's recorded input row range stamped on it, or `data` itself when the result has none. */
export function stampResultRowRange(result: AnalysisResult, data: DataStruct): DataStruct {
  const range = readRecordedRowRange(result.parameters?.[ROW_RANGE_PARAM]);
  const datasetId = result.sources[0]?.datasetId;
  return range && datasetId ? stampInputRowRanges(data, [{ datasetId, ...range }]) : data;
}
