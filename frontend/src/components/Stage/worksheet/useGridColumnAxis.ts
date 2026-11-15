// The worksheet grid's COLUMN axis, extracted from GridViewport.tsx (component
// ceiling): which value columns draw, and the spacers that keep the scroll
// extent right. Hidden columns drop out of the axis entirely and a frozen
// prefix is pinned (sticky) outside the windowed run, so the windowing math
// runs over the SCROLLING shown columns only — its cost follows the viewport,
// never the hidden or frozen count (lib/worksheetColumnView.ts for the model).
//
// With nothing hidden or frozen and no resized column this is the same single
// divide the grid always did (`computeAxisWindow`); a resized column switches
// to the prefix-sum offsets path, built over the scrolling columns only.

import { useMemo } from "react";

import {
  buildOffsets,
  computeAxisWindow,
  computeAxisWindowOffsets,
  DEFAULT_COL_OVERSCAN,
  DEFAULT_COL_WIDTH,
  DEFAULT_FALLBACK_COLS,
} from "../../../lib/gridwindow";
import type { TextColumn } from "../../../lib/originTextColumns";
import { ariaPositions, hiddenRuns, pinnableCount, splitColumns } from "../../../lib/worksheetColumnView";

export interface ColumnAxisInput {
  colCount: number;
  hidden: ReadonlySet<number>;
  frozen: number;
  /** The X column's width (it differs for a date X). */
  xWidth: number;
  colWidths: Record<number, number>;
  scrollLeft: number;
  viewportWidth: number;
  gutterWidth: number;
}

export interface ColumnAxis {
  /** Pinned columns, left to right, and the sticky `left` of each. */
  frozenCols: number[];
  frozenLeft: (col: number) => number;
  /** The windowed slice of the scrolling columns, with its spacers. */
  visibleCols: number[];
  leadingSpacer: number;
  trailingSpacer: number;
  /** Scroll offset where column `col` starts among the scrolling columns;
   *  null when it does not scroll (hidden, frozen, out of range). */
  startOfCol: (col: number) => number | null;
  /** Scroll offset just after column `col` (where a text column anchored to it sits). */
  startAfterCol: (col: number) => number | null;
  /** Pixels the gutter, X and frozen columns take: the scroll area is the rest. */
  fixedWidth: number;
}

export function useGridColumnAxis(a: ColumnAxisInput): ColumnAxis {
  const { colCount, hidden, frozen, xWidth, colWidths, scrollLeft, viewportWidth, gutterWidth } = a;
  // Only the frozen prefix that FITS stays pinned (room left for at least one
  // scrolling column); the rest scroll like any other column, so the sheet is
  // always reachable however many columns were frozen or however narrow the pane.
  const { frozenCols, scrollCols } = useMemo(() => {
    const split = splitColumns(colCount, hidden, frozen);
    const n = pinnableCount(split.frozenCols, (c) => colWidths[c] ?? DEFAULT_COL_WIDTH, gutterWidth + xWidth, viewportWidth, DEFAULT_COL_WIDTH);
    return n === split.frozenCols.length
      ? split
      : { frozenCols: split.frozenCols.slice(0, n), scrollCols: [...split.frozenCols.slice(n), ...split.scrollCols] };
  }, [colCount, hidden, frozen, colWidths, xWidth, gutterWidth, viewportWidth]);
  const hasCustomCols = useMemo(() => Object.keys(colWidths).some((k) => Number(k) >= 0), [colWidths]);
  // Built ONLY when some value column was resized (the uniform fast path needs
  // no array) and only over the scrolling columns.
  const colOffsets = useMemo(
    () => (hasCustomCols ? buildOffsets(scrollCols.length, (i) => colWidths[scrollCols[i]] ?? DEFAULT_COL_WIDTH) : null),
    [hasCustomCols, scrollCols, colWidths],
  );
  const lefts = useMemo(() => {
    const m = new Map<number, number>();
    let x = gutterWidth + xWidth;
    for (const c of frozenCols) {
      m.set(c, x);
      x += colWidths[c] ?? DEFAULT_COL_WIDTH;
    }
    return { m, end: x };
  }, [frozenCols, colWidths, gutterWidth, xWidth]);
  const fixedWidth = lefts.end;
  const available = Math.max(0, viewportWidth - fixedWidth);
  const win = colOffsets
    ? computeAxisWindowOffsets(scrollLeft, available, colOffsets, { overscan: DEFAULT_COL_OVERSCAN, fallbackCount: DEFAULT_FALLBACK_COLS })
    : computeAxisWindow(scrollLeft, available, scrollCols.length, {
        itemSize: DEFAULT_COL_WIDTH,
        overscan: DEFAULT_COL_OVERSCAN,
        fallbackCount: DEFAULT_FALLBACK_COLS,
      });
  const at = (i: number) => (colOffsets ? colOffsets[i] : i * DEFAULT_COL_WIDTH);
  return {
    frozenCols,
    frozenLeft: (c) => lefts.m.get(c) ?? 0,
    visibleCols: scrollCols.slice(win.start, win.end),
    leadingSpacer: win.offset,
    trailingSpacer: colOffsets ? win.totalSize - colOffsets[win.end] : (scrollCols.length - win.end) * DEFAULT_COL_WIDTH,
    startOfCol: (c) => {
      const i = scrollCols.indexOf(c);
      return i < 0 ? null : at(i);
    },
    startAfterCol: (c) => {
      const i = scrollCols.indexOf(c);
      return i < 0 ? null : at(i + 1);
    },
    fixedWidth,
  };
}

/** What the header and screen readers need to know about hidden columns: where
 *  each hidden run sits, and (only while something is hidden) every column's
 *  true ARIA position, text columns included. */
export function useColumnMarks(colCount: number, hidden: ReadonlySet<number>, textCols: readonly TextColumn[], textAnchors: readonly number[]) {
  const runs = useMemo(() => hiddenRuns(colCount, hidden), [colCount, hidden]);
  const colPos = useMemo(
    () => (hidden.size > 0 ? ariaPositions(colCount, textAnchors, textCols.map((t) => t.shortName)) : undefined),
    [hidden, colCount, textAnchors, textCols],
  );
  return { runs, colPos };
}
