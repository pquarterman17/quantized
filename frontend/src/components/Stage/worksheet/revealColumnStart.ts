// Where a "reveal this column" request (Go to Source and friends) puts the column in the grid's
// scrollable content, as the scroll offset at which the column starts.
//
// The column axis (`useGridColumnAxis`) knows only the value columns. A read-only text column the
// file places before the numeric run (`TextColumnLayout.before`) or right after the pinned run is
// drawn in the flow ahead of the windowed run, `colWidth` wide, but carries no width in that model.
// Ignoring it left the target column up to a whole column past the visible edge in a narrow docked
// window (acceptance pass 6, C2: the `val` column of a sheet whose first column is text). The text
// columns drawn inline BETWEEN scrolling columns are left out: they are only drawn there while their
// anchor is in the window, so their place in the content moves with the scroll position.

import type { TextColumn } from "../../../lib/originTextColumns";
import { layoutTextColumns } from "./textColumns";

export interface RevealColumnInput {
  /** A channel index, or a text column's short name. */
  column: number | string | undefined;
  textCols: readonly TextColumn[];
  /** `textColumnAnchors`: the channel each text column follows (-1: before every channel). */
  textAnchors: readonly number[];
  hidden: ReadonlySet<number>;
  /** The pinned (frozen) value columns that fit. */
  pinned: readonly number[];
  colCount: number;
  /** Text columns' width (value columns use their own, via the axis). */
  textWidth: number;
  startOfCol: (col: number) => number | null;
  startAfterCol: (col: number) => number | null;
}

/** The scroll offset at which the target column starts, or null when it does not scroll (hidden,
 *  pinned, out of range, or no column asked for). */
export function revealColumnStart(a: RevealColumnInput): number | null {
  const { column, textCols, textAnchors, hidden, pinned, colCount, textWidth } = a;
  const layout = layoutTextColumns(textCols, textAnchors, [], hidden, pinned);
  const last = pinned[pinned.length - 1];
  const afterPinned = last === undefined ? [] : layout.after(last);
  // The text columns sitting ahead of the windowed run, in drawing order.
  const ahead = [...layout.before, ...afterPinned];
  const lead = ahead.length * textWidth;
  const textIdx = typeof column === "string" ? textCols.findIndex((t) => t.shortName === column) : -1;
  if (textIdx >= 0) {
    const k = ahead.indexOf(textCols[textIdx]);
    if (k >= 0) return k * textWidth;
    const anchor = textAnchors[textIdx] ?? -1;
    const after = anchor < 0 ? 0 : a.startAfterCol(anchor);
    return after == null ? null : lead + after;
  }
  if (typeof column !== "number" || column < 0 || column >= colCount) return null;
  const start = a.startOfCol(column);
  return start == null ? null : lead + start;
}
