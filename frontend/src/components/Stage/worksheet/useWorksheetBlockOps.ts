// Rectangular block operations for the worksheet (MAIN_PLAN #34): copy, paste,
// clear and fill-down over a row × column selection.
//
// A separate hook rather than more of useWorksheetView.ts, which is already
// 600+ lines — the size-ratchet habit applies to a hook file even where no test
// enforces it. All the translation logic is pure in lib/clipboardGrid.ts; this
// file only reads the current selection, calls the store, and reports.
//
// Every operation goes through `setCellBlock`, NOT a loop of `setCellValue`:
// one undo entry, one recompute, one macro line. A paste that took N presses of
// Ctrl+Z to reverse would not be a usable undo model.

import { copyText } from "../../../lib/clipboard";
import {
  clearEdits,
  fillDownEdits,
  gridToClipboardText,
  parseClipboardGrid,
  pasteEdits,
  type PasteBounds,
} from "../../../lib/clipboardGrid";
import { useApp } from "../../../store/useApp";

export interface BlockOpsSource {
  datasetId: string;
  /** Selected original-row indices (unsorted is fine — helpers sort). */
  rows: number[];
  /** Selected column indices; -1 is the x/time column. */
  cols: number[];
  /** Row count of the dataset. */
  rowCount: number;
  /** Writable value columns — total columns minus computed/formula ones. */
  writableCols: number;
  /** Current cell value; null when missing. */
  valueAt: (row: number, col: number) => number | null | undefined;
  setStatus: (msg: string) => void;
}

export interface BlockOpsApi {
  copyBlock: () => void;
  /** Copy then clear — the spreadsheet Cut. */
  cutBlock: () => void;
  pasteBlock: () => void;
  clearBlock: () => void;
  fillDown: () => void;
  /** Insert blank rows above the selection (MAIN_PLAN #34). */
  insertRows: () => void;
  /** Delete the selected rows (MAIN_PLAN #34). */
  deleteRows: () => void;
  /** True when a rectangular selection exists to act on. */
  hasBlock: boolean;
  /** True when rows are selected — the row operations need rows, not a block. */
  hasRows: boolean;
}

/** Cell count past which a paste announces itself first. Chosen as the point
 *  where the apply plus React's re-render stops being imperceptible on a
 *  mid-range machine; below it, a status message would flash and vanish. */
export const LARGE_PASTE_CELLS = 5_000;

/** Ascending, de-duplicated — the order a spreadsheet block is read in. */
function ordered(xs: readonly number[]): number[] {
  return [...new Set(xs)].sort((a, b) => a - b);
}

export function useWorksheetBlockOps(src: BlockOpsSource): BlockOpsApi {
  const setCellBlock = useApp((s) => s.setCellBlock);
  const insertRowsAction = useApp((s) => s.insertRows);
  const deleteRowsAction = useApp((s) => s.deleteRows);
  const rows = ordered(src.rows);
  const cols = ordered(src.cols);
  const bounds: PasteBounds = { rows: src.rowCount, writableCols: src.writableCols };
  const hasBlock = rows.length > 0 && cols.length > 0;

  function copyBlock() {
    if (!hasBlock) {
      src.setStatus("select rows and columns first");
      return;
    }
    // No header row: this block is meant to round-trip back into a paste, and
    // a header would land in the first data row. The header-bearing export is
    // the existing "Copy rows".
    const grid = rows.map((r) => cols.map((c) => src.valueAt(r, c) ?? null));
    void copyText(gridToClipboardText(grid)).then((ok) =>
      src.setStatus(ok ? `copied ${rows.length}×${cols.length} block` : "clipboard unavailable"),
    );
  }

  function pasteBlock() {
    if (rows.length === 0 || cols.length === 0) {
      src.setStatus("select the top-left cell to paste into");
      return;
    }
    void navigator.clipboard
      ?.readText()
      .then((text) => {
        const grid = parseClipboardGrid(text);
        if (grid.length === 0) {
          src.setStatus("clipboard is empty");
          return;
        }
        const { edits, clippedCells, readOnlyCells } = pasteEdits(grid, rows[0], cols[0], bounds);
        if (edits.length === 0) {
          src.setStatus("nothing pasted (outside the sheet or read-only columns)");
          return;
        }
        // MAIN #34: say something BEFORE a big apply, not after. The apply is
        // O(rows + edits) and a normal paste lands inside a frame, so this is
        // not a progress bar — it is the honest fix for the only case that can
        // actually stall: a very large block, where a silent freeze reads as a
        // hang. Below the threshold nothing is announced, because a message
        // that flashes for 3 ms is noise.
        if (edits.length >= LARGE_PASTE_CELLS) {
          src.setStatus(`pasting ${edits.length.toLocaleString()} cells…`);
        }
        setCellBlock(src.datasetId, edits, "paste cells");
        // Say what was DROPPED. Silently ignoring overflow is how a user ends up
        // believing a paste landed when half of it did not.
        const notes = [
          clippedCells ? `${clippedCells} outside the sheet` : "",
          readOnlyCells ? `${readOnlyCells} on read-only columns` : "",
        ].filter(Boolean);
        src.setStatus(
          `pasted ${edits.length} cell${edits.length === 1 ? "" : "s"}` +
            (notes.length ? ` — dropped ${notes.join(", ")}` : ""),
        );
      })
      .catch(() => src.setStatus("clipboard read unavailable"));
  }

  function clearBlock() {
    if (!hasBlock) {
      src.setStatus("select rows and columns first");
      return;
    }
    const edits = clearEdits(rows, cols, bounds);
    if (edits.length === 0) {
      src.setStatus("nothing to clear (read-only columns)");
      return;
    }
    setCellBlock(src.datasetId, edits, "clear cells");
    src.setStatus(`cleared ${edits.length} cell${edits.length === 1 ? "" : "s"}`);
  }

  function fillDown() {
    const edits = fillDownEdits(rows, cols, bounds, src.valueAt);
    if (edits.length === 0) {
      src.setStatus("select at least two rows to fill down");
      return;
    }
    setCellBlock(src.datasetId, edits, "fill down");
    src.setStatus(`filled ${edits.length} cell${edits.length === 1 ? "" : "s"}`);
  }

  function cutBlock() {
    if (!hasBlock) {
      src.setStatus("select rows and columns first");
      return;
    }
    // Copy FIRST and only clear once the clipboard write resolved — a cut that
    // clears after a failed copy destroys data with nowhere to paste it.
    const grid = rows.map((r) => cols.map((c) => src.valueAt(r, c) ?? null));
    void copyText(gridToClipboardText(grid)).then((ok) => {
      if (!ok) {
        src.setStatus("clipboard unavailable — nothing was cut");
        return;
      }
      const edits = clearEdits(rows, cols, bounds);
      if (edits.length === 0) {
        src.setStatus("copied, but those columns are read-only");
        return;
      }
      setCellBlock(src.datasetId, edits, "cut cells");
      src.setStatus(`cut ${edits.length} cell${edits.length === 1 ? "" : "s"}`);
    });
  }

  function insertRows() {
    if (rows.length === 0) {
      src.setStatus("select a row to insert above");
      return;
    }
    // Insert as many rows as are selected, above the topmost — the spreadsheet
    // convention, and it makes "make room for 3 more" one gesture.
    insertRowsAction(src.datasetId, rows[0], rows.length);
    src.setStatus(`inserted ${rows.length} row${rows.length === 1 ? "" : "s"}`);
  }

  function deleteRows() {
    if (rows.length === 0) {
      src.setStatus("select rows to delete");
      return;
    }
    deleteRowsAction(src.datasetId, rows);
    src.setStatus(`deleted ${rows.length} row${rows.length === 1 ? "" : "s"}`);
  }

  return {
    copyBlock,
    cutBlock,
    pasteBlock,
    clearBlock,
    fillDown,
    insertRows,
    deleteRows,
    hasBlock,
    hasRows: rows.length > 0,
  };
}
