// The plot chip's text for a row window (ROW_RANGE_CONTRACT 3.4); lazy, with the chip.

import { rowRangeLabel, rowRangeRefusal, type RowRange } from "./rowRange";

/** The range the plot may apply to a sheet of `rows` rows (null = none, or one
 *  that does not fit), and the chip's text. A range past the sheet's end (rows
 *  deleted or re-imported underneath it) is never clamped: the plot draws every
 *  row and the chip says the range is not applied. */
export function plotRowRangeState(
  range: RowRange | null | undefined,
  rows: number,
): { applied: RowRange | null; label: string; refusal: string | null } {
  if (!range) return { applied: null, label: "", refusal: null };
  // A window that FOLLOWS a named range says whose (ROW_RANGE_CONTRACT 5.2). One that cannot be read draws NO rows
  // (never every row), and says why.
  const tag = range.namedAs ? `${range.namedAs}: ` : "";
  if (range.refused !== undefined) return { applied: null, label: `${tag}no rows`, refusal: `${range.refused}. The plot draws no rows until the named range can be read, or this link is cleared` };
  const refusal = rowRangeRefusal(range, rows);
  const label = rowRangeLabel(range);
  return refusal ? { applied: null, label: `${tag}${label} not applied`, refusal } : { applied: range, label: `${tag}${label} of ${rows.toLocaleString()}`, refusal: null };
}
