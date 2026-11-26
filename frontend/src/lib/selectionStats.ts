// Selection statistics for the status bar (Origin / Excel: select cells, read
// Count, Sum, Mean, Min and Max without building anything). Pure: the worksheet
// pane supplies the selected rows and columns plus a cell reader, and
// `store/selectionStats.ts` carries the result to the status bar.
//
// Row-state model: rows excluded from analysis (manual exclusion or a filter,
// lib/rowstate) are SKIPPED, exactly as the worksheet's own stats footer reads
// the analysis rows only, and the skipped count is reported so the number is
// never silently different from what the user selected. Text cells (a
// categorical column, a date X column) are counted separately and never summed.
// Blank and non-finite cells are ignored.

export interface SelectionStats {
  /** Finite numeric cells that entered the sums. */
  count: number;
  sum: number;
  mean: number;
  min: number;
  max: number;
  /** Text-valued cells in the selection (not summed). */
  text: number;
  /** Cells in excluded / filtered-out rows, left out of every number above. */
  skipped: number;
  /** Every selected cell, whatever it holds. */
  cells: number;
}

export interface SelectionStatsInput {
  /** Selected ORIGINAL row indices. */
  rows: ReadonlySet<number> | readonly number[];
  /** Selected columns; -1 is the X / time column. */
  cols: ReadonlySet<number> | readonly number[];
  valueAt: (row: number, col: number) => unknown;
  /** True for a column whose cells are text for statistics (categorical, date X). */
  isTextCol?: (col: number) => boolean;
  /** True for a row excluded from analysis. */
  isSkippedRow?: (row: number) => boolean;
}

/** Statistics of the selected cells, or null when none of them is numeric. */
export function computeSelectionStats(input: SelectionStatsInput): SelectionStats | null {
  const { valueAt, isTextCol, isSkippedRow } = input;
  const cols = [...input.cols];
  const textCols = new Set(cols.filter((c) => isTextCol?.(c)));
  let count = 0;
  let text = 0;
  let skipped = 0;
  let cells = 0;
  let sum = 0;
  let comp = 0; // Neumaier compensation: millions of cells must not drift the sum
  let min = Infinity;
  let max = -Infinity;
  for (const row of input.rows) {
    const out = isSkippedRow?.(row) ?? false;
    for (const col of cols) {
      cells++;
      if (out) {
        skipped++;
        continue;
      }
      if (textCols.has(col)) {
        text++;
        continue;
      }
      const v = valueAt(row, col);
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      count++;
      const t = sum + v;
      comp += Math.abs(sum) >= Math.abs(v) ? sum - t + v : v - t + sum;
      sum = t;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (count === 0) return null;
  const total = sum + comp;
  return { count, sum: total, mean: total / count, min, max, text, skipped, cells };
}

/** The status-bar line: "Count 12 · Sum 3.4 · Mean 0.28 · Min 0.1 · Max 0.9",
 *  then the text and skipped notes when there are any. `fmt` formats a number
 *  by its stat key (the worksheet footer's own display formatter). */
export function formatSelectionStats(s: SelectionStats, fmt: (key: string, v: number) => string): string {
  const parts = [
    `Count ${fmt("N", s.count)}`,
    `Sum ${fmt("sum", s.sum)}`,
    `Mean ${fmt("mean", s.mean)}`,
    `Min ${fmt("min", s.min)}`,
    `Max ${fmt("max", s.max)}`,
  ];
  if (s.text) parts.push(`${s.text} text`);
  if (s.skipped) parts.push(`${s.skipped} excluded skipped`);
  return parts.join(" · ");
}

/** True when the selection is worth a status-bar readout: a single cell would
 *  only repeat itself four times. */
export function worthShowing(s: SelectionStats | null): s is SelectionStats {
  return s !== null && s.cells >= 2;
}

/** One-entry cache over `computeSelectionStats`, keyed by the identity of the
 *  selection sets and the data: asking again with the same selection and data
 *  returns the same object without touching a cell. `key` lists every value
 *  the result depends on (compared with `Object.is`). */
export function memoSelectionStats(): (key: readonly unknown[], input: () => SelectionStatsInput) => SelectionStats | null {
  let last: { key: readonly unknown[]; result: SelectionStats | null } | null = null;
  return (key, input) => {
    if (last && last.key.length === key.length && last.key.every((k, i) => Object.is(k, key[i]))) return last.result;
    const result = computeSelectionStats(input());
    last = { key, result };
    return result;
  };
}
