// Typing and pasting PAST the end of a worksheet, as in Origin: the sheet
// grows to take the data instead of dropping it. Two entry points, both used
// only by the worksheet's cell cursor (components/Stage/worksheet/
// useGridCursor.ts), both ONE undo step:
//   - `growAndSetCell`: a value typed into the blank entry row under the data
//     appends the row(s) and writes the cell;
//   - `pasteGrowing`: a pasted block that runs off the bottom (or, on a sheet
//     with no computed columns, off the right) appends the rows / columns it
//     needs first, then pastes.
// Growing appends AFTER the last row and column, so no existing row or column
// index moves: exclusions, filters and every row-indexed sidecar
// (lib/rowSidecars.ts) stay aligned without a remap — `insertRows` and
// `insertColumn` own those rules. Each step records its own history entry;
// `mergeHistorySince` folds them into the first, whose snapshot is the state
// before the whole gesture (the pattern `addDataset` uses for its window).
// Loaded with the worksheet pane (a lazy chunk).

import { parseClipboardGrid, pasteEdits, pasteTargetRows } from "../lib/clipboardGrid";
import { categoricalLevels } from "../lib/categorical";
import { sidecarRowCount } from "../lib/rowSidecars";
import { useApp } from "./useApp";
import { insertColumn } from "./worksheetColumns";

const get = useApp.getState;

/** Dataset `id`'s row and column count as of NOW — the cell cursor reads it
 *  inside a key handler, where the render's copy is one commit behind. */
export function liveShape(id: string): { rows: number; cols: number } | null {
  const ds = get().datasets.find((d) => d.id === id);
  return ds ? { rows: ds.data.time.length, cols: ds.data.labels.length } : null;
}

/** The newest history entry's sequence number (0 when the stack is empty). */
export function historyMark(): number {
  return get().history.at(-1)?.seq ?? 0;
}

/** Fold every history entry recorded after `mark` into the first of them,
 *  relabelled `label`: one Undo then reverses the whole gesture. */
export function mergeHistorySince(mark: number, label: string): void {
  useApp.setState((s) => {
    const first = s.history.findIndex((e) => e.seq > mark);
    if (first < 0) return {};
    return { history: [...s.history.slice(0, first), { ...s.history[first], label }] };
  });
}

/** Write `value` at (`row`, `col`) where `row` is at or past the numeric end:
 *  append blank rows up to it, then set the cell. A blank (NaN) typed into
 *  the entry row adds nothing. */
export function growAndSetCell(id: string, row: number, col: number, value: number): void {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return;
  // The row domain is the longer of the numbers and the text sidecars (a
  // text-only tail row is not empty): grow from its end, never into it.
  const n = sidecarRowCount(ds.data.metadata, ds.data.time.length);
  if (row < n) {
    get().setCellValue(id, row, col, value);
    return;
  }
  if (!Number.isFinite(value)) return;
  const mark = historyMark();
  get().insertRows(id, n, row - n + 1);
  get().setCellValue(id, row, col, value);
  mergeHistorySince(mark, "cell edit");
}

/** Paste clipboard `text` with its top-left cell at display position
 *  `anchorPos`, column `anchorCol` (-1 = X). `order` is the grid's display
 *  order; `grow` allows appending rows/columns (only on an unfiltered,
 *  unsorted view, where display position = row index). Returns the status. */
export function pasteGrowing(
  id: string,
  text: string,
  anchorPos: number,
  anchorCol: number,
  order: readonly number[],
  grow: boolean,
): string {
  const grid = parseClipboardGrid(text);
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return "";
  if (grid.length === 0) return "clipboard is empty";
  const width = grid.reduce((m, r) => Math.max(m, r.length), 0); // no spread: a paste can be 1M rows
  const formulas = ds.formulas?.length ?? 0;
  const base = ds.data.labels.length - formulas;
  const needRows = grow ? anchorPos + grid.length - Math.max(order.length, ds.data.time.length) : 0;
  const needCols = grow && formulas === 0 ? anchorCol + width - base : 0;
  const mark = historyMark();
  for (let i = 0; i < needCols; i++) insertColumn(id, Number.MAX_SAFE_INTEGER);
  if (needRows > 0) {
    const now = get().datasets.find((d) => d.id === id)!;
    get().insertRows(id, sidecarRowCount(now.data.metadata, now.data.time.length), needRows);
  }
  const now = get().datasets.find((d) => d.id === id)!;
  // After growing, the view is unfiltered and unsorted: position = row.
  const rows = needRows > 0 ? Array.from({ length: now.data.time.length }, (_, r) => r) : order;
  const anchor = rows[anchorPos];
  if (anchor === undefined) return "select the top-left cell to paste into";
  const nowBase = now.data.labels.length - (now.formulas?.length ?? 0);
  const result = pasteEdits(grid, pasteTargetRows(rows, anchor), anchorCol, {
    rows: now.data.time.length,
    writableCols: nowBase,
    levelsAt: (c) => categoricalLevels(now.data, c),
  });
  if (result.edits.length) get().setCellBlock(id, result.edits, "paste cells", result.newLevels);
  mergeHistorySince(mark, "paste cells");
  const skipped = result.skippedCells ? `, skipped ${result.skippedCells} non-numeric` : "";
  const grew = [needRows > 0 ? `${needRows} row${needRows === 1 ? "" : "s"}` : "", needCols > 0 ? `${needCols} column${needCols === 1 ? "" : "s"}` : ""]
    .filter(Boolean)
    .join(" and ");
  const dropped = [
    result.clippedCells ? `${result.clippedCells} outside the sheet` : "",
    result.readOnlyCells ? `${result.readOnlyCells} on read-only columns` : "",
  ].filter(Boolean);
  if (result.edits.length === 0) return `nothing pasted${skipped}${dropped.length ? ` — dropped ${dropped.join(", ")}` : ""}`;
  return (
    `pasted ${result.edits.length} cell${result.edits.length === 1 ? "" : "s"}${skipped}` +
    (grew ? ` (added ${grew})` : "") +
    (dropped.length ? ` — dropped ${dropped.join(", ")}` : "")
  );
}
