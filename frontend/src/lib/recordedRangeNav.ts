// Go to Source and Reopen in tool for a SAVED ranged result (ROW_RANGE_CONTRACT section 3.3, owner decision OG20;
// the record itself is lib/inputRowRange.ts). Pure: no store, no React.
//
// A result that read a row range recorded it (`{ from, to, rows }`: SOURCE rows, 0-based inclusive, and the
// source's row count). This module turns that record into the rows to select, or into a REASON it must not.
//
// HISTORICAL, NEVER LIVE, and FAIL CLOSED. Row positions are only meaningful while the source is as it was when
// the result was saved. The result's own freshness is the proof: a result that is not current (the source changed,
// was re-imported, or the result was saved stale) may point at rows that moved, so nothing is selected and no tool
// is reopened on the record. The row count is checked too, which catches an edit the fingerprint cannot see (a
// pending preview). Never clamped: a window past the end is refused.

import type { AnalysisResult } from "./analysisResult";
import { isSnapshotResult, snapshotResultState, sourcesFingerprint } from "./analysisResultFreshness";
import { readOutputRowRanges, readRecordedRowRange, ROW_RANGE_PARAM, recordedRowRangeLabel, type RecordedRowRange } from "./inputRowRange";
import { rowRangeLabel } from "./rowRange";
import type { Dataset } from "./types";

export interface RecordedRangeTarget extends RecordedRowRange {
  datasetId: string;
}

/** The ranges `result` recorded: a snapshot's own (on its first source), or an output worksheet's, one per ranged
 *  source. Empty when the result read every row. */
export function recordedRangeTargets(result: AnalysisResult, outputMetadata?: Readonly<Record<string, unknown>>): RecordedRangeTarget[] {
  const own = readRecordedRowRange(result.parameters?.[ROW_RANGE_PARAM]);
  const first = result.sources[0]?.datasetId;
  if (own) return first ? [{ ...own, datasetId: first }] : [];
  return readOutputRowRanges(outputMetadata);
}

/** Is the result still the one its recorded rows describe? Fails closed: what cannot be judged is not current. */
export function recordedRowsCurrent(result: AnalysisResult, datasets: readonly Dataset[]): boolean {
  if (isSnapshotResult(result)) return snapshotResultState(result, datasets) === "current";
  if (result.stale || !result.sourceFingerprint) return false;
  const now = sourcesFingerprint(result, new Map(datasets.map((d) => [d.id, d])));
  return now !== null && now === result.sourceFingerprint;
}

export type RecordedRangePlan =
  | { ok: true; datasetId: string; sourceName: string; rows: number[]; range: RecordedRowRange; label: string }
  | { ok: false; datasetId: string; reason: string };

/** The rows to select for one recorded range, or why not. `current` is `recordedRowsCurrent`. */
export function planRecordedRange(target: RecordedRangeTarget, datasets: readonly Dataset[], current: boolean): RecordedRangePlan {
  const source = datasets.find((d) => d.id === target.datasetId);
  const no = (reason: string): RecordedRangePlan => ({ ok: false, datasetId: target.datasetId, reason });
  const saved = recordedRowRangeLabel(target);
  if (!source) return no(`The source worksheet no longer exists, so ${saved} cannot be selected.`);
  if (source.pending) return no(`“${source.name}” is still loading: open it, then try again.`);
  if (!current) return no(`“${source.name}” has changed since this result was saved, so ${saved} may now be other rows. Run the analysis again to select its rows.`);
  const rows = source.data.time.length;
  if (rows !== target.rows || target.to >= rows) {
    return no(`“${source.name}” now has ${rows.toLocaleString()} rows (it had ${target.rows.toLocaleString()} when this result was saved), so ${saved} no longer lines up.`);
  }
  const list = Array.from({ length: target.to - target.from + 1 }, (_, i) => target.from + i);
  return { ok: true, datasetId: source.id, sourceName: source.name, rows: list, range: target, label: `${rowRangeLabel(target)} of ${rows.toLocaleString()}` };
}

/** One plan per recorded range of `result`. */
export function planRecordedRanges(result: AnalysisResult, outputMetadata: Readonly<Record<string, unknown>> | undefined, datasets: readonly Dataset[]): RecordedRangePlan[] {
  const targets = recordedRangeTargets(result, outputMetadata);
  if (!targets.length) return [];
  const current = recordedRowsCurrent(result, datasets);
  return targets.map((t) => planRecordedRange(t, datasets, current));
}
