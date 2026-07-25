// Rectangular clipboard <-> worksheet translation (MAIN_PLAN #34).
//
// The worksheet could edit one cell at a time, so cleaning up a copied or messy
// experimental table meant a detour through Excel/Origin. This module owns the
// pure half of fixing that: parsing what a spreadsheet actually puts on the
// clipboard, and turning a pasted grid into a bounded list of cell edits.
//
// Nothing here touches the store. The bulk apply (ONE undo entry, ONE recompute
// — not N of each) is `useApp.setCellBlock`.
//
// COLUMN INDEXING follows the existing `setCellValue` contract: -1 is the x/time
// column, 0..n-1 are value channels. Callers pass that space straight through.

/** One cell to write. `value` is NaN for a blank/unparseable source cell — the
 *  same "missing" marker single-cell editing already commits. */
export interface CellEdit {
  row: number;
  col: number;
  value: number;
}

export interface PasteBounds {
  /** Total rows in the destination dataset. */
  rows: number;
  /** Number of WRITABLE value columns (formula columns are computed and
   *  read-only — `setCellValue` refuses them, so this excludes them). */
  writableCols: number;
}

export interface PasteResult {
  edits: CellEdit[];
  /** Source cells dropped because they fell outside the destination grid. */
  clippedCells: number;
  /** Source cells dropped because they landed on a read-only computed column. */
  readOnlyCells: number;
}

/** Parse clipboard text into a rectangular grid of raw strings.
 *
 *  Handles what spreadsheets actually emit: tab-separated columns, CRLF or LF
 *  rows, and a trailing newline (Excel always adds one — treating it as a real
 *  empty row would silently blank a row of the destination). Rows are NOT padded
 *  to equal length; `pasteEdits` handles ragged input per row. */
export function parseClipboardGrid(text: string): string[][] {
  if (text === "") return [];
  const withoutTrailing = text.replace(/\r?\n$/, "");
  if (withoutTrailing === "") return [];
  return withoutTrailing.split(/\r?\n/).map((line) => line.split("\t"));
}

/** Serialize a rectangular block of numbers to TSV for the clipboard.
 *
 *  `null`/NaN become empty fields so the row width stays constant — the same
 *  convention `payloadToTSV` uses, and what a spreadsheet reads back as blank. */
export function gridToClipboardText(grid: readonly (readonly (number | null)[])[]): string {
  return grid
    .map((row) =>
      row.map((v) => (v == null || !Number.isFinite(v) ? "" : String(v))).join("\t"),
    )
    .join("\n");
}

/** Turn a parsed clipboard grid into the edits to apply at an anchor cell.
 *
 *  SHAPE MISMATCH IS CLIPPED, never grown: a paste can overwrite existing cells
 *  but must not silently change the dataset's dimensions — a worksheet row count
 *  is bound to the x column and to every row-indexed piece of state (exclusions,
 *  filters, fit overlays), so growing it from a paste would invalidate all of
 *  them at once. Cells that fall outside are reported in `clippedCells` so the
 *  UI can say how many were dropped instead of silently losing them. */
export function pasteEdits(
  grid: readonly (readonly string[])[],
  anchorRow: number,
  anchorCol: number,
  bounds: PasteBounds,
): PasteResult {
  const edits: CellEdit[] = [];
  let clippedCells = 0;
  let readOnlyCells = 0;

  for (let r = 0; r < grid.length; r++) {
    const row = anchorRow + r;
    const cells = grid[r];
    for (let c = 0; c < cells.length; c++) {
      const col = anchorCol + c;
      if (row < 0 || row >= bounds.rows || col < -1) {
        clippedCells++;
        continue;
      }
      if (col >= bounds.writableCols) {
        // Past the writable columns: either a computed column or off the end.
        // Both are refusals rather than silent no-ops, and they are reported
        // separately because "you pasted onto a formula" is a different
        // message from "your paste was wider than the sheet".
        readOnlyCells++;
        continue;
      }
      edits.push({ row, col, value: parseCell(cells[c]) });
    }
  }
  return { edits, clippedCells, readOnlyCells };
}

/** Blank/unparseable -> NaN, matching single-cell editing's "missing" marker.
 *  Strips thousands separators and surrounding whitespace, which is what a
 *  paste out of a formatted spreadsheet column actually contains. */
export function parseCell(raw: string): number {
  const text = raw.trim().replace(/,/g, "");
  if (text === "") return Number.NaN;
  const n = Number(text);
  return Number.isNaN(n) ? Number.NaN : n;
}

/** Edits that blank every cell in a rectangular selection (Delete on a block).
 *  Read-only columns are skipped, not silently "cleared". */
export function clearEdits(
  rows: readonly number[],
  cols: readonly number[],
  bounds: PasteBounds,
): CellEdit[] {
  const edits: CellEdit[] = [];
  for (const row of rows) {
    if (row < 0 || row >= bounds.rows) continue;
    for (const col of cols) {
      if (col < -1 || col >= bounds.writableCols) continue;
      edits.push({ row, col, value: Number.NaN });
    }
  }
  return edits;
}

/** Edits that copy the FIRST selected row's value down the rest of the
 *  selection, per column (spreadsheet "fill down").
 *
 *  `valueAt` reads the current grid so this stays pure — the caller supplies the
 *  accessor rather than this module reaching into the store. */
export function fillDownEdits(
  rows: readonly number[],
  cols: readonly number[],
  bounds: PasteBounds,
  valueAt: (row: number, col: number) => number | null | undefined,
): CellEdit[] {
  const ordered = [...rows].filter((r) => r >= 0 && r < bounds.rows).sort((a, b) => a - b);
  if (ordered.length < 2) return []; // nothing below the source row to fill
  const [source, ...rest] = ordered;
  const edits: CellEdit[] = [];
  for (const col of cols) {
    if (col < -1 || col >= bounds.writableCols) continue;
    const v = valueAt(source, col);
    if (v == null) continue;
    for (const row of rest) edits.push({ row, col, value: v });
  }
  return edits;
}
