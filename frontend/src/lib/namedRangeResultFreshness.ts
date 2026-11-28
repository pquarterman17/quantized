// A saved result that read a NAMED range goes out of date when the range moves (ROW_RANGE_CONTRACT 5.2, "goes out of
// date when the resolved rows change"). Pure: no store, no React.
//
// WHY THE ROW FINGERPRINT IS NOT ENOUGH. A result's source fingerprint (lib/analysisResultFreshness.ts) hashes the
// source worksheet, so an edit or an insert in the source already marks the result out of date. A RETARGET of the range
// changes no data: the same worksheet, other rows. The result then still describes rows 21-44 while the range, and
// every plot, fit and formula that follows it, now reads rows 30-44. The save recorded the range's id and the rows it
// read (`RecordedRowRange.rangeId`, lib/inputRowRange.ts); this compares them with the range now.
//
// FAIL CLOSED, but only where a range moved. A range that no longer exists is NOT a change: nothing it described moved,
// and the record still says what was read (Delete's dialog already named the dependants). A range on a worksheet whose
// full rows are not loaded cannot be judged yet. A result saved before the id was recorded (or on typed rows) holds no
// id and is never judged by NAME: a later range carrying the same name is a different range.

import type { AnalysisResult } from "./analysisResult";
import { readOutputRowRanges, readRecordedRowRange, ROW_RANGE_PARAM, type RecordedRowRange } from "./inputRowRange";
import { currentNamedRanges } from "./namedRangeSource";
import { namedRangeIssue, type NamedRange } from "./namedRanges";
import { rowRangeLabel } from "./rowRange";
import type { Dataset } from "./types";

export interface RecordedNamedRange extends RecordedRowRange {
  /** The source worksheet the range was read on. */
  datasetId: string;
  rangeId: string;
}

/** The named ranges `result` read through, as recorded: a snapshot's own (on its first source), or its outputs'. */
export function recordedNamedRanges(result: AnalysisResult, datasets: readonly Pick<Dataset, "id" | "data">[]): RecordedNamedRange[] {
  const own = readRecordedRowRange(result.parameters?.[ROW_RANGE_PARAM]);
  const first = result.sources[0]?.datasetId;
  if (own) return own.rangeId && first ? [{ ...own, datasetId: first, rangeId: own.rangeId }] : [];
  return result.outputs.flatMap((ref) =>
    readOutputRowRanges(datasets.find((d) => d.id === ref.datasetId)?.data.metadata).flatMap((r) => (r.rangeId ? [{ ...r, rangeId: r.rangeId }] : [])),
  );
}

/** What the range now covers, in the words the recorded rows use. */
function nowLabel(range: NamedRange, rows: number): string {
  return range.target.rows ? rowRangeLabel(range.target.rows) : `all ${rows.toLocaleString()} rows`;
}

/** Why the named range `recorded` no longer covers what the result read, or null (unchanged, removed, or not yet
 *  judgeable). The text is the panel's: "Out of date: range X changed since this result was saved (...)". */
export function namedRangeChange(
  recorded: RecordedNamedRange,
  ranges: readonly NamedRange[],
  datasets: readonly Pick<Dataset, "id" | "name" | "data" | "pending">[],
): string | null {
  const range = ranges.find((r) => r.id === recorded.rangeId);
  if (!range) return null;
  const sheet = datasets.find((d) => d.id === range.target.datasetId);
  if (sheet?.pending != null) return null;
  const head = `Out of date: range ${range.name} changed since this result was saved`;
  const then = rowRangeLabel(recorded);
  const issue = namedRangeIssue(range, datasets);
  if (issue) return `${head} (it read ${then}; now ${issue}). Reopen in tool, or run the analysis again.`;
  if (range.target.datasetId !== recorded.datasetId) return `${head} (it read ${then} of another worksheet; the range now points at ${sheet!.name}). Reopen in tool, or run the analysis again.`;
  const rows = range.target.rows ?? { from: 0, to: sheet!.data.time.length - 1 };
  if (rows.from === recorded.from && rows.to === recorded.to) return null;
  return `${head} (it read ${then}; now ${nowLabel(range, sheet!.data.time.length)}). Reopen in tool to run it on the range's current rows.`;
}

/** The out-of-date notes of `result`, one per named range it read that moved. `ranges` defaults to the project's. */
export function rangeChangeNotes(
  result: AnalysisResult,
  datasets: readonly Dataset[],
  ranges: readonly NamedRange[] = currentNamedRanges(),
): string[] {
  if (!ranges.length) return [];
  return recordedNamedRanges(result, datasets).flatMap((recorded) => namedRangeChange(recorded, ranges, datasets) ?? []);
}
