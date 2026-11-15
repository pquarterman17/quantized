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
