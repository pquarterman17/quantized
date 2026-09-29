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

/** One cell to write. `value` is NaN for a blank source cell — the same
 *  "missing" marker single-cell editing already commits. */
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
  /** A categorical column's level table (null for a numeric column). Pasted
   *  labels map to level codes through it. */
  levelsAt?: (col: number) => readonly string[] | null | undefined;
}

export interface PasteResult {
  edits: CellEdit[];
  /** Source cells dropped because they fell outside the destination grid. */
  clippedCells: number;
  /** Source cells dropped because they landed on a read-only computed column. */
  readOnlyCells: number;
  /** Non-empty text a numeric column cannot take (a word, or an ambiguous
   *  "1,5"). Skipped — writing NaN would silently blank the cell. */
  skippedCells: number;
  /** Labels to append to a categorical column's level table, by column. The
   *  codes in `edits` already point at them (levels.length + i). */
  newLevels: Record<number, string[]>;
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

/** The rows a paste anchored at `anchor` fills: the VISIBLE order from the
 *  anchor downward. A sorted or filtered sheet shows rows out of index order,
 *  and a paste must land where the user sees it — never on a hidden row. */
export function pasteTargetRows(order: readonly number[], anchor: number): number[] {
  const at = order.indexOf(anchor);
  return at < 0 ? [] : order.slice(at);
}

/** Turn a parsed clipboard grid into the edits to apply at an anchor cell.
 *
 *  `targetRows` are the destination rows in display order (see
 *  `pasteTargetRows`): grid row r lands on `targetRows[r]`.
 *
 *  SHAPE MISMATCH IS CLIPPED, never grown: a paste can overwrite existing cells
 *  but must not silently change the dataset's dimensions — a worksheet row count
 *  is bound to the x column and to every row-indexed piece of state (exclusions,
 *  filters, fit overlays), so growing it from a paste would invalidate all of
 *  them at once. Cells that fall outside are reported in `clippedCells` so the
 *  UI can say how many were dropped instead of silently losing them. */
export function pasteEdits(
  grid: readonly (readonly string[])[],
  targetRows: readonly number[],
  anchorCol: number,
  bounds: PasteBounds,
): PasteResult {
  const edits: CellEdit[] = [];
  let clippedCells = 0;
  let readOnlyCells = 0;
  let skippedCells = 0;
  const newLevels: Record<number, string[]> = {};

  for (let r = 0; r < grid.length; r++) {
    const row = r < targetRows.length ? targetRows[r] : -1;
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
      const levels = col >= 0 ? bounds.levelsAt?.(col) : null;
      const value = levels ? levelCode(cells[c], levels, col, newLevels) : parseCell(cells[c]);
      if (value === null) skippedCells++;
      else edits.push({ row, col, value });
    }
  }
  return { edits, clippedCells, readOnlyCells, skippedCells, newLevels };
}

/** A pasted cell in a categorical column, resolved the way
 *  `setCategoricalCell` resolves a typed label: blank clears, an existing
 *  level is picked (case-insensitive), a number is kept as a raw code (the
 *  store's guard validates it), and any other label EXTENDS the table —
 *  recorded in `added[col]`, deduplicated case-insensitively. */
function levelCode(
  raw: string,
  levels: readonly string[],
  col: number,
  added: Record<number, string[]>,
): number {
  const text = raw.trim();
  if (text === "") return Number.NaN;
  const key = text.toLowerCase();
  const existing = levels.findIndex((l) => l.toLowerCase() === key);
  if (existing >= 0) return existing;
  const code = parseCell(text);
  if (code !== null) return code;
  const fresh = (added[col] ??= []);
  const prior = fresh.findIndex((l) => l.toLowerCase() === key);
  if (prior >= 0) return levels.length + prior;
  fresh.push(text);
  return levels.length + fresh.length - 1;
}

/** A valid thousands grouping: "1,500", "-12,345.6". Anything else with a
 *  comma ("1,5" — is it 1.5 or 15?) is ambiguous and refused. */
const THOUSANDS = /^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/;

/** Blank -> NaN, matching single-cell editing's "missing" marker (a paste can
 *  clear). Unparseable text -> null: the caller SKIPS it rather than writing
 *  NaN over real data. Strips surrounding whitespace and valid thousands
 *  separators, which is what a formatted spreadsheet column contains. */
export function parseCell(raw: string): number | null {
  let text = raw.trim();
  if (text === "") return Number.NaN;
  if (text.includes(",")) {
    if (!THOUSANDS.test(text)) return null;
    text = text.replace(/,/g, "");
  }
  const n = Number(text);
  return Number.isNaN(n) ? null : n;
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
 *  `rows` are taken in the order given — the caller passes the DISPLAY order,
 *  so on a sorted sheet the source is the top row the user sees, not the
 *  smallest original index. `valueAt` reads the current grid so this stays
 *  pure — the caller supplies the accessor rather than this module reaching
 *  into the store. */
export function fillDownEdits(
  rows: readonly number[],
  cols: readonly number[],
  bounds: PasteBounds,
  valueAt: (row: number, col: number) => number | null | undefined,
): CellEdit[] {
  const ordered = [...new Set(rows)].filter((r) => r >= 0 && r < bounds.rows);
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
