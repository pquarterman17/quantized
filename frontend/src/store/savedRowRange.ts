// The row range a result is SAVED under (owner decision OG20; the contract is
// plans/ROW_RANGE_CONTRACT.md 3.3 and 9.1). A tool that narrowed its input to a
// row range computed its result on those rows only, so the save records the
// window (lib/inputRowRange.ts) instead of refusing: a snapshot result keeps it in
// its envelope, a committed output worksheet in a private metadata key, both gated
// at the v9 rung so an older release refuses the file rather than show the result
// as if it had read every row.
//
// Only producers that READ the range are listed: a tool that does not narrow
// (Signal Processing, Curie-Weiss, a transform) saves under a range as it always
// did and records nothing. A batch run records its rows in the existing `rowRuns`
// key, and a statistical test's record counts the rows it read; neither is here.
//
// What the save still refuses (fail closed): a range whose rows were all deleted
// (`was`) or that runs past the sheet. The tool refuses to compute on such a range,
// so a result under it can only be a stale snapshot, and recording the window would
// describe rows the tool did not read.
//
// The range is read from the live shared selection at save time, as the tools read it
// when they compute: a tool recomputes on every range change, so the two agree.

import type { AnalysisSelection } from "../lib/analysisSelection";
import { readRecordedRowRange, recordRowRange, rowRangeRecordRefusal, type RecordedRowRange, type SourceRowRange } from "../lib/inputRowRange";
import { FIT_MODEL_PRODUCER } from "../lib/fitModelRecipe";
import type { RowRange } from "../lib/rowRange";
import { TIME_SERIES_RESULT } from "../lib/toolResultKinds";
import type { Dataset } from "../lib/types";
import { rowRangeOn } from "./analysisSelection";

/** Snapshot results (their tables live in the envelope). */
const RANGED_SNAPSHOT_PRODUCERS: ReadonlySet<string> = new Set([
  "distribution-analysis", "fit-y-by-x", "variability-analysis", "outlier-screening", "multivariate-analysis",
  FIT_MODEL_PRODUCER, TIME_SERIES_RESULT,
]);

/** Committed output worksheets. */
const RANGED_OUTPUT_PRODUCERS: ReadonlySet<string> = new Set([
  "curve-measure", "optical-gap", "spectro-extras", "time-series", "tabulate", "surface-fit", "ellipse-fit",
  "multivar-cluster", "multivar-ext", "km-curve", "row-t-tests", "fit-model-columns",
]);

export interface SavedRange {
  /** One entry per source, in order; null = that source has no range. */
  ranges: (RecordedRowRange | null)[];
  /** The status line that refuses the save, or null. */
  refusal: string | null;
}

function rangesFor(producers: ReadonlySet<string>, producerId: string, sources: readonly Dataset[], what: string, selection?: AnalysisSelection | null): SavedRange {
  const ranges: (RecordedRowRange | null)[] = [];
  if (!producers.has(producerId)) return { ranges: sources.map(() => null), refusal: null };
  for (const source of sources) {
    const live: RowRange | null = selection === undefined ? rowRangeOn(source.id) : rowRangeOn(source.id, selection);
    if (!live) { ranges.push(null); continue; }
    const rows = source.data.time.length;
    const refusal = rowRangeRecordRefusal(live, rows, what);
    if (refusal) return { ranges: [], refusal };
    ranges.push(recordRowRange(live, rows));
  }
  return { ranges, refusal: null };
}

/** The range a snapshot result of `producerId` on `source` is saved under. */
export function snapshotSaveRange(producerId: string, source: Dataset, what: string): { range: RecordedRowRange | null; refusal: string | null } {
  const { ranges, refusal } = rangesFor(RANGED_SNAPSHOT_PRODUCERS, producerId, [source], what);
  return { range: ranges[0] ?? null, refusal };
}

/** The ranges a committed output of `producerId` is saved under, one per source. */
export function outputSaveRanges(producerId: string, sources: readonly Dataset[], what: string, selection?: AnalysisSelection | null): SavedRange {
  return rangesFor(RANGED_OUTPUT_PRODUCERS, producerId, sources, what, selection);
}

/** The live windows a commit of `producerId` over `sourceIds` would read, as `[from, to]` per source (null =
 *  none; a range whose rows are gone reads as none, because the commit refuses it). Unvalidated: the commit key
 *  only needs to tell one window from another, and a view can show "already added" before it commits. */
export function liveOutputRanges(producerId: string, sourceIds: readonly string[], selection?: AnalysisSelection | null): (readonly [number, number] | null)[] {
  if (!RANGED_OUTPUT_PRODUCERS.has(producerId)) return sourceIds.map(() => null);
  return sourceIds.map((id) => {
    const live = selection === undefined ? rowRangeOn(id) : rowRangeOn(id, selection);
    return live && live.was === undefined ? [live.from, live.to] as const : null;
  });
}

/** The ranged sources as the entries an output worksheet records. */
export function sourceRowRanges(sources: readonly Dataset[], ranges: readonly (RecordedRowRange | null)[]): SourceRowRange[] {
  return sources.flatMap((source, index) => {
    const range = readRecordedRowRange(ranges[index]);
    return range ? [{ ...range, datasetId: source.id }] : [];
  });
}
