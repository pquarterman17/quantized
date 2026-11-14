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
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** `p` clamped into the grid (an empty grid clamps every row to 0). */
export function clampCell(p: CellPos, b: GridBounds): CellPos {
  return { pos: clamp(p.pos, 0, Math.max(0, b.rows - 1)), col: clamp(p.col, -1, Math.max(-1, b.cols - 1)) };
}

/** A one-cell range at `p`. */
export function cellAt(p: CellPos, b: GridBounds): CellRange {
  const c = clampCell(p, b);
  return { anchor: c, focus: c };
}

/** Move the focus by (dRow, dCol); with `extend` the anchor stays (Shift +
 *  arrow), otherwise the range collapses onto the new cell. */
export function moveCursor(r: CellRange, dRow: number, dCol: number, extend: boolean, b: GridBounds): CellRange {
  const focus = clampCell({ pos: r.focus.pos + dRow, col: r.focus.col + dCol }, b);
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

/** The range's columns, left to right (-1 = X). */
export function rangeCols(r: CellRange): number[] {
  const { left, right } = rangeRect(r);
  return Array.from({ length: right - left + 1 }, (_, i) => left + i);
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
