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
import { splitColumns } from "../../../lib/worksheetColumnView";

export interface ColumnAxisInput {
  colCount: number;
  hidden: ReadonlySet<number>;
  frozen: number;
  /** Per-column width (-1 = X). */
  widthOf: (col: number) => number;
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
  const { colCount, hidden, frozen, widthOf, colWidths, scrollLeft, viewportWidth, gutterWidth } = a;
  const { frozenCols, scrollCols } = useMemo(() => splitColumns(colCount, hidden, frozen), [colCount, hidden, frozen]);
  const hasCustomCols = useMemo(() => Object.keys(colWidths).some((k) => Number(k) >= 0), [colWidths]);
  // Built ONLY when some value column was resized (the uniform fast path needs
  // no array) and only over the scrolling columns.
  const colOffsets = useMemo(
    () => (hasCustomCols ? buildOffsets(scrollCols.length, (i) => colWidths[scrollCols[i]] ?? DEFAULT_COL_WIDTH) : null),
    [hasCustomCols, scrollCols, colWidths],
  );
  const lefts = useMemo(() => {
    const m = new Map<number, number>();
    let x = gutterWidth + widthOf(-1);
    for (const c of frozenCols) {
      m.set(c, x);
      x += widthOf(c);
    }
    return { m, end: x };
    // widthOf is a fresh closure each render; colWidths is its real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frozenCols, colWidths, gutterWidth]);
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
