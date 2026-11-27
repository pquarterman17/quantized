// What a SAVED result records about the row range its tool read (owner decision
// OG20, ROW_RANGE_CONTRACT sections 3.3 and 9.1). Pure: no store, no React.
//
// A snapshot result (Distribution, Fit Y by X, ...) records the range in its
// envelope, `parameters.rowRange`; a committed output worksheet records it in a
// private metadata key on the OUTPUT (`INPUT_ROW_RANGE_KEY`, one entry per ranged
// source). Both are `{ from, to, rows }`: the window in SOURCE worksheet rows,
// 0-based inclusive like `RowRange`, and the source's row count at the time.
//
// HISTORICAL, NEVER LIVE. The record says what the result was computed on. A later
// insert or delete in the source does not move it (the result is then marked out
// of date by its source fingerprint, which is what tells the reader the rows moved),
// and nothing here reads the live range back. The label says "when saved".
//
// DUPLICATE KEYS. The same recipe on rows 21-44 and on every row are two results.
// `withRowRange` adds the window to the key's question only when one was recorded,
// so every unranged key stays byte-identical to what older files hold.

import { rowRangeLabel, rowRangeRefusal, type RowRange } from "./rowRange";
import { INPUT_ROW_RANGE_KEY } from "./rowSidecars";
import type { DataStruct } from "./types";

/** Envelope `parameters` key of a snapshot result's recorded range. */
export const ROW_RANGE_PARAM = "rowRange";

export interface RecordedRowRange {
  /** First row, 0-based inclusive (a SOURCE worksheet row). */
  from: number;
  /** Last row, 0-based inclusive. */
  to: number;
  /** The source's row count when the result was saved ("of 48"). */
  rows: number;
}

/** One ranged source of an output worksheet. */
export interface SourceRowRange extends RecordedRowRange {
  datasetId: string;
}

export function recordRowRange(range: RowRange, rows: number): RecordedRowRange {
  return { from: range.from, to: range.to, rows };
}

/** Why the live `range` cannot be recorded for a sheet of `rows` rows, or null. A range
 *  whose rows were all deleted, or that runs past the sheet, is refused: a result must
 *  never be saved under a window it did not read. */
export function rowRangeRecordRefusal(range: RowRange, rows: number, what: string): string | null {
  const why = rowRangeRefusal(range, rows);
  return why ? `${what} cannot be saved: ${why}. Clear or reset the row range; nothing was saved.` : null;
}

/** `value` as a recorded range, or null when it is anything else (a hand-edited file): integers,
 *  `0 <= from <= to < rows`. Fails closed: a malformed record reads as "none recorded". */
export function readRecordedRowRange(value: unknown): RecordedRowRange | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { from, to, rows } = value as Record<string, unknown>;
  if (!Number.isInteger(from) || !Number.isInteger(to) || !Number.isInteger(rows)) return null;
  const [a, b, n] = [from as number, to as number, rows as number];
  return a >= 0 && b >= a && b < n ? { from: a, to: b, rows: n } : null;
}

/** "rows 21-44 of 48" (1-based). The caller says "when saved". */
export function recordedRowRangeLabel(range: RecordedRowRange): string {
  return `${rowRangeLabel(range)} of ${range.rows.toLocaleString()}`;
}

/** The ranges recorded on an output worksheet's metadata (invalid entries are skipped). */
export function readOutputRowRanges(metadata: Readonly<Record<string, unknown>> | undefined): SourceRowRange[] {
  const raw = metadata?.[INPUT_ROW_RANGE_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const range = readRecordedRowRange(entry);
    const id = (entry as { datasetId?: unknown } | null)?.datasetId;
    return range && typeof id === "string" ? [{ ...range, datasetId: id }] : [];
  });
}

/** The "Input rows" line of a saved result's panel, or null when no range was recorded: "rows 21-44 of 48
 *  (when saved)". `output` is the committed output worksheet's metadata (an output records its range there);
 *  a snapshot result records it in its envelope. "When saved" because it is history: a later insert or delete
 *  in the source does not move it, and marks the result out of date instead. */
export function savedInputRowsLine(
  parameters: Readonly<Record<string, unknown>> | undefined, outputMetadata?: Readonly<Record<string, unknown>>,
): string | null {
  const own = readRecordedRowRange(parameters?.[ROW_RANGE_PARAM]);
  const labels = own ? [recordedRowRangeLabel(own)] : readOutputRowRanges(outputMetadata).map(recordedRowRangeLabel);
  return labels.length ? `${labels.join("; ")} (when saved)` : null;
}

/** `data` with the ranges recorded under `INPUT_ROW_RANGE_KEY`; the same object when there are none. */
export function stampInputRowRanges(data: DataStruct, ranges: readonly SourceRowRange[]): DataStruct {
  if (!ranges.length) return data;
  return { ...data, metadata: { ...data.metadata, [INPUT_ROW_RANGE_KEY]: ranges.map((r) => ({ ...r })) } };
}

/** A key question that names the window; `question` itself when none was recorded. */
export function withRowRange<Q extends Record<string, unknown>>(question: Q, range: RowRange | null | undefined): Q {
  return range ? { ...question, rowRange: [range.from, range.to] } : question;
}
