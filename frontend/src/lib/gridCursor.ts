// The worksheet's cell cursor and cell-range selection — pure geometry, no
// React, no store (the hook is components/Stage/worksheet/useGridCursor.ts).
//
// Positions are in DISPLAY space, the space the user navigates: `pos` indexes
// the grid's visible row order (after the view filter and view sort), `col` is
// a column index where -1 is the pinned X column and 0..n-1 the value columns,
// in their on-screen left-to-right order. The anchor is where a shift-extended
// selection started; the focus is the active cell the keyboard moves.

export interface CellPos {
  pos: number;
  col: number;
}

export interface CellRange {
  anchor: CellPos;
  focus: CellPos;
}

/** The navigable extent: `rows` display rows (positions 0..rows-1) and value
 *  columns 0..cols-1 plus the X column at -1. */
export interface GridBounds {
  rows: number;
  cols: number;
  /** Hidden value columns (lib/worksheetColumnView.ts): never landed on. */
  hidden?: ReadonlySet<number>;
}

/** The nearest shown column to `col` (preferring the left), -1 (X) at worst. */
function shownNear(col: number, b: GridBounds, prefer: -1 | 1 = -1): number {
  if (!b.hidden?.has(col)) return col;
  for (let d = 1; d <= b.cols; d++) {
    const left = col - d < 0 || !b.hidden.has(col - d) ? col - d : null;
    const right = col + d < b.cols && !b.hidden.has(col + d) ? col + d : null;
    const pick = prefer < 0 ? (left ?? right) : (right ?? left);
    if (pick !== null) return pick;
  }
  return -1;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** `p` clamped into the grid (an empty grid clamps every row to 0). A cell on a
 *  hidden column moves to the nearest shown one, on the `prefer` side first: a
 *  range's anchor passes the side of its focus, so the range never grows. */
export function clampCell(p: CellPos, b: GridBounds, prefer: -1 | 1 = -1): CellPos {
  const col = clamp(p.col, -1, Math.max(-1, b.cols - 1));
  return { pos: clamp(p.pos, 0, Math.max(0, b.rows - 1)), col: shownNear(col, b, prefer) };
}

/** A one-cell range at `p`. */
export function cellAt(p: CellPos, b: GridBounds): CellRange {
  const c = clampCell(p, b);
  return { anchor: c, focus: c };
}

/** Move the focus by (dRow, dCol); with `extend` the anchor stays (Shift +
 *  arrow), otherwise the range collapses onto the new cell. */
export function moveCursor(r: CellRange, dRow: number, dCol: number, extend: boolean, b: GridBounds): CellRange {
  // Step column by column, over hidden ones; at the last shown column stay put.
  let col = r.focus.col;
  const step = Math.sign(dCol);
  for (let n = Math.abs(dCol); n > 0; n--) {
    let next = col + step;
    while (next >= 0 && next < b.cols && b.hidden?.has(next)) next += step;
    if (next < -1 || next >= b.cols) break;
    col = next;
  }
  const focus = clampCell({ pos: r.focus.pos + dRow, col }, b);
  return extend ? { anchor: r.anchor, focus } : { anchor: focus, focus };
}

/** Jump the focus to an edge (Ctrl + arrow / Home / End). */
export function jumpCursor(
  r: CellRange,
  edge: "top" | "bottom" | "left" | "right",
  extend: boolean,
  b: GridBounds,
): CellRange {
  const f = r.focus;
  const to =
    edge === "top" ? { pos: 0, col: f.col }
      : edge === "bottom" ? { pos: b.rows - 1, col: f.col }
        : edge === "left" ? { pos: f.pos, col: -1 }
          : { pos: f.pos, col: b.cols - 1 };
  const focus = clampCell(to, b);
  return extend ? { anchor: r.anchor, focus } : { anchor: focus, focus };
}

/** The range's inclusive rectangle. */
export function rangeRect(r: CellRange): { top: number; bottom: number; left: number; right: number } {
  return {
    top: Math.min(r.anchor.pos, r.focus.pos),
    bottom: Math.max(r.anchor.pos, r.focus.pos),
    left: Math.min(r.anchor.col, r.focus.col),
    right: Math.max(r.anchor.col, r.focus.col),
  };
}

/** Is display cell (pos, col) inside the range? */
export function inRange(r: CellRange | null, pos: number, col: number): boolean {
  if (!r) return false;
  const { top, bottom, left, right } = rangeRect(r);
  return pos >= top && pos <= bottom && col >= left && col <= right;
}

/** The range's columns, left to right (-1 = X), without any `hidden` ones. */
export function rangeCols(r: CellRange, hidden?: ReadonlySet<number>): number[] {
  const { left, right } = rangeRect(r);
  const cols = Array.from({ length: right - left + 1 }, (_, i) => left + i);
  return hidden?.size ? cols.filter((c) => !hidden.has(c)) : cols;
}

/** The range's ORIGINAL row indices, top to bottom, read through the display
 *  `order`; a position past the end of `order` (the blank entry row) is
 *  dropped — it has no row yet. */
export function rangeRows(r: CellRange, order: readonly number[]): number[] {
  const { top, bottom } = rangeRect(r);
  return order.slice(top, bottom + 1);
}

/** Is `key` a character that starts editing the cursor cell (type-to-edit)?
 *  One printable character with no Ctrl/Cmd/Alt — Shift is fine ("E", "+"). */
export function startsTyping(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey;
}
