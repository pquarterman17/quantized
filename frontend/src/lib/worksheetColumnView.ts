// Worksheet column visibility: which value columns are HIDDEN (Origin's Hide /
// Show Columns) and how many leading columns are FROZEN (Origin's freeze
// panes). Pure — the store writes live in store/worksheetColumnView.ts, the
// grid reads the splits below.
//
// A VIEW setting only: a hidden column keeps its data, its index, its plot
// bindings and every formula that names it; the grid just does not draw it.
// Both fields are channel-indexed like every other Dataset field, so they
// remap through lib/channelRemap.ts's `remapDatasetChannels` (which owns
// `remapHiddenCols` / `remapFrozenCols`) on a column insert / delete / move. The X column (-1) is always shown and always pinned.
//
// `frozen` is a COUNT of leading column indices (0..frozen-1), not a set: a
// frozen prefix keeps the on-screen order equal to the index order, so the
// keyboard cursor and the pinned region never disagree. Hidden columns inside
// the prefix simply do not take a pinned slot.

/** Value columns 0..colCount-1 that are shown, left to right. */
export function shownColumns(colCount: number, hidden: ReadonlySet<number>): number[] {
  const out: number[] = [];
  for (let c = 0; c < colCount; c++) if (!hidden.has(c)) out.push(c);
  return out;
}

/** The shown columns split into the pinned prefix (index < `frozen`) and the
 *  horizontally scrolling rest. */
export function splitColumns(
  colCount: number,
  hidden: ReadonlySet<number>,
  frozen: number,
): { frozenCols: number[]; scrollCols: number[] } {
  const shown = shownColumns(colCount, hidden);
  const n = Math.max(0, Math.min(frozen, colCount));
  return { frozenCols: shown.filter((c) => c < n), scrollCols: shown.filter((c) => c >= n) };
}

/** Each run of hidden columns, keyed by the shown column just before it in
 *  left-to-right order (-1 = the X column) — where the header draws its
 *  "N hidden" marker. */
export function hiddenRuns(colCount: number, hidden: ReadonlySet<number>): Map<number, number[]> {
  const runs = new Map<number, number[]>();
  let prev = -1;
  for (let c = 0; c < colCount; c++) {
    if (!hidden.has(c)) {
      prev = c;
      continue;
    }
    const run = runs.get(prev);
    if (run) run.push(c);
    else runs.set(prev, [c]);
  }
  return runs;
}

/** How many of the leading `frozenCols` (left to right) can stay pinned: the
 *  pinned width (`fixedBase` = gutter + X, plus each pinned column) must leave
 *  at least `minScroll` px of the viewport for the columns that scroll, or the
 *  rest of the sheet could never be reached. An unmeasured viewport (<= 0)
 *  pins them all. */
export function pinnableCount(
  frozenCols: readonly number[],
  widthOf: (col: number) => number,
  fixedBase: number,
  viewport: number,
  minScroll: number,
): number {
  if (viewport <= 0) return frozenCols.length;
  let used = fixedBase;
  for (let i = 0; i < frozenCols.length; i++) {
    used += widthOf(frozenCols[i]);
    if (used > viewport - minScroll) return i;
  }
  return frozenCols.length;
}

export interface ColumnAria {
  /** 1-based `aria-colindex` of each value column (gutter = 1, X = 2). */
  value: number[];
  /** The same for each read-only text column, by short name. */
  text: Record<string, number>;
  /** `aria-colcount`: every column, hidden ones included. */
  count: number;
}

/** True ARIA column positions while some column is hidden: a hidden column
 *  leaves a gap, and a text column sits at its file-order spot after its anchor
 *  channel (`anchors[i]` = -1: before every channel) — see textColumnAnchors. */
export function ariaPositions(colCount: number, anchors: readonly number[], names: readonly string[]): ColumnAria {
  const value: number[] = [];
  const text: Record<string, number> = {};
  let pos = 3;
  const place = (at: number) => {
    anchors.forEach((a, i) => {
      if (a === at || (at === colCount - 1 && a >= colCount)) text[names[i]] = pos++;
    });
  };
  place(-1);
  for (let c = 0; c < colCount; c++) {
    value.push(pos++);
    place(c);
  }
  return { value, text, count: pos - 1 };
}
