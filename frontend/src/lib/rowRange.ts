// A contiguous row range of one worksheet (ROW_RANGE_CONTRACT section 3).
//
// A range is POSITIONS, 0-based and inclusive, like `excludedRows`: it is a
// window onto the sheet, so its size never changes under sort, and it follows
// insert and delete through the same `shiftForInsert` / `shiftForDelete` the
// exclusion marks use. It is NOT a fifth kind of exclusion: it is never part of
// `droppedRows` (lib/rowstate.ts) and narrows only the consumer it is set on
// (an analysis input, in this slice). Pure: no store, no React. Nothing here is
// persisted.
//
// Row numbers shown to the user are SOURCE rows, 1-based ("rows 21-44"); the
// stored fields stay 0-based. `rowRangeLabel` is the one place that converts.

import { shiftForDelete, shiftForInsert } from "./rowShift";

export interface RowRange {
  /** First row, 0-based inclusive. */
  from: number;
  /** Last row, 0-based inclusive; `to >= from` unless the range is gone. */
  to: number;
  /** Set when every row of the range was deleted: the label of what it was
   *  ("rows 21-44"), so the refusal can say what no longer exists. */
  was?: string;
  /** NAMED LINK (ROW_RANGE_CONTRACT 5.2, `{ named: id }`): the id of the named range this window follows live. `from` and
   *  `to` are then a CACHE of what it resolved to (kept current by `store/rangeLinkSync`), and only `named` is saved. */
  named?: string;
  /** The linked range's name, for the chip and for provenance (`RecordedRowRange.name`). */
  namedAs?: string;
  /** Why a named link cannot be read now ("named range removed", "its rows were replaced"). Such a link shows NO rows and
   *  is refused by every consumer with this text; it is never widened to every row. */
  refused?: string;
}

/** "rows 21-44" (1-based), or "row 21" for one row. */
export function rowRangeLabel(range: Pick<RowRange, "from" | "to">): string {
  return range.from === range.to ? `row ${range.from + 1}` : `rows ${range.from + 1}-${range.to + 1}`;
}

/** Why `range` cannot be applied to a sheet of `rows` rows, or null. Never
 *  clamped: a range past the end is refused (formula ranges are never clamped
 *  either), and a range whose rows were all deleted is refused, never widened
 *  to "every row". */
export function rowRangeRefusal(range: RowRange, rows: number): string | null {
  if (range.refused !== undefined) return range.refused;
  if (range.was !== undefined) return `${range.was} no longer exist`;
  const { from, to } = range;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) return "The row range is not valid.";
  if (to >= rows) return `${rowRangeLabel(range)} is beyond the worksheet's ${rows.toLocaleString()} row${rows === 1 ? "" : "s"}`;
  return null;
}

/** The range after inserting `count` rows at `at`. Rows inserted above (or at
 *  the first row) move it; rows inserted inside make it grow; rows appended
 *  after it leave it alone, so appending never extends a range. */
export function shiftRangeForInsert(range: RowRange, at: number, count: number): RowRange {
  if (range.was !== undefined) return range;
  const [from, to] = shiftForInsert([range.from, range.to], at, count);
  return { from, to };
}

/** The range after deleting `deleted`: its surviving rows stay contiguous, so
 *  `from` becomes the first survivor, `to` the last, each moved up by the
 *  deletions above it. No survivor: the range is gone (`was` names it). */
export function shiftRangeForDelete(range: RowRange, deleted: ReadonlySet<number>): RowRange {
  if (range.was !== undefined || deleted.size === 0) return range;
  let from = range.from;
  let to = range.to;
  while (from <= to && deleted.has(from)) from++;
  while (to >= from && deleted.has(to)) to--;
  if (from > to) return { from: range.from, to: range.from - 1, was: `${rowRangeLabel(range)}` };
  const [nextFrom, nextTo] = shiftForDelete([from], deleted).concat(shiftForDelete([to], deleted));
  return { from: nextFrom, to: nextTo };
}

/** The rows of `selected` as one range, or why they are not one block (the
 *  worksheet's "Use as row range" is offered only for a contiguous block). */
export function contiguousRowRange(selected: Iterable<number>): { range: RowRange } | { reason: string } {
  const rows = [...new Set(selected)].sort((a, b) => a - b);
  if (rows.length === 0) return { reason: "select the rows first" };
  const runs: string[] = [];
  let start = rows[0];
  for (let i = 1; i <= rows.length; i++) {
    if (i < rows.length && rows[i] === rows[i - 1] + 1) continue;
    const end = rows[i - 1];
    runs.push(start === end ? String(start + 1) : `${start + 1}-${end + 1}`);
    start = rows[i];
  }
  if (runs.length === 1) return { range: { from: rows[0], to: rows[rows.length - 1] } };
  return { reason: `the selection has gaps (rows ${runs.join(", ")}): use Extract rows, or Exclude others` };
}

export { sanitizeRowRange } from "./rowRangeSanitize"; // eager (PlotView reads it), so it lives apart from the rest of this module
