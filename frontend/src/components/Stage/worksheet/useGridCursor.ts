// The worksheet's cell cursor — the Origin/Excel way of working a grid from
// the keyboard (worksheet audit #4/#5). Click a cell (or drag, or shift-click)
// to place the cursor / select a cell range; then:
//   arrows move (Shift extends, Ctrl jumps to the edge), Home/End, PageUp/Down;
//   Enter / Shift+Enter move down / up, Tab / Shift+Tab right / left;
//   typing replaces the cell, F2 edits it, Esc cancels an edit (or clears the
//   cursor), Delete clears the range; Ctrl+C / X / V / D copy, cut, paste and
//   fill down on the range, Ctrl+A selects every cell; Shift+F10 opens the
//   column menu and Shift+F2 the header editor for the cursor's column.
// A value typed or pasted past the last row (into the blank entry row) grows
// the sheet (store/worksheetGrow.ts), so a new workbook is typed into exactly
// as in Origin.
//
// The cursor is SESSION state in display space (lib/gridCursor.ts); a click on
// a row number or a column header switches back to whole-line selection and
// clears it, and a cell click clears the column selection — so the block the
// clipboard commands act on is always the one the user can see highlighted.

import { useEffect, useId, useMemo, useState } from "react";

import { categoricalLevels } from "../../../lib/categorical";
import { parseClipboardGrid } from "../../../lib/clipboardGrid";
import { useEscapeSurface } from "../../../lib/escapeStack";
import {
  cellAt,
  clampCell,
  inRange,
  jumpCursor,
  moveCursor,
  rangeCols,
  rangeRect,
  rangeRows,
  startsTyping,
  type CellRange,
  type GridBounds,
} from "../../../lib/gridCursor";
import { editRefusalNotice, isRederived } from "../../../lib/rederived";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { growAndSetCell, liveShape, pasteGrowing } from "../../../store/worksheetGrow";
import type { GridCursorProps, GridReveal } from "./GridViewport";
import { useCellEdit } from "./useCellEdit";
import { useWorksheetBlockOps, type BlockOpsApi } from "./useWorksheetBlockOps";
import type { WorksheetView } from "./useWorksheetView";

export interface GridCursorHooks {
  /** Shift+F10 / the Menu key: open the column menu for `col` at (x, y). */
  onColumnMenu: (col: number, x: number, y: number) => void;
  /** Shift+F2: edit `col`'s Long Name / Units / Comments. */
  onEditHeader: (col: number) => void;
}

export interface GridCursor {
  range: CellRange | null;
  /** Props for GridViewport's `cursor`. */
  grid: GridCursorProps;
  /** The block operations the toolbar and keys use: the cell range while
   *  there is one, otherwise the row × column selection's. */
  blockOps: BlockOpsApi;
  /** The pane's keydown: true when the cursor handled the key. */
  onKeyDown: (e: React.KeyboardEvent) => boolean;
  /** Drop the cursor (a row-number or header click took over). */
  clear: () => void;
  /** Scroll request for the focused cell, or null. */
  reveal: GridReveal | null;
  /** Put the cursor on the cell at original row `row`, column `col` (Find). */
  goTo: (row: number, col: number) => void;
}

const PAGE = 20;
const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

function isField(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export function useGridCursor(ds: Dataset, view: WorksheetView, hooks: GridCursorHooks): GridCursor {
  const gridId = useId();
  const setStatus = useApp((s) => s.setStatus);
  const [range, setRange] = useState<CellRange | null>(null);
  const [reveal, setReveal] = useState<GridReveal | null>(null);
  // Select-all (Ctrl+A) keeps the cell that was active before it, as Excel
  // does: the range covers everything, but typing / arrows act from `active`.
  const [all, setAll] = useState<{ range: CellRange; active: CellRange } | null>(null);
  const { order, data, baseCount } = view;
  // Hidden columns (lib/worksheetColumnView.ts): the cursor steps over them
  // and a range's block ops leave them out.
  const hidden = useMemo(() => new Set(ds.hiddenCols ?? []), [ds.hiddenCols]);
  const readOnly = isRederived(ds);
  // The entry row only where display position = row index (no view filter or
  // view sort) and the data is fully loaded and editable.
  const entryRow = !readOnly && !view.filterActive && !view.sort && ds.pending == null;
  const cellId = (pos: number, col: number) => `${gridId}-r${pos}-c${col + 1}`;

  useEffect(() => setRange(null), [ds.id]);
  // An undo, a delete or a filter can shrink the sheet under the cursor: keep
  // the range on cells that exist.
  const rowCount = order.length + (entryRow ? 1 : 0);
  const colCount = data.labels.length;
  useEffect(() => {
    setRange((r) => {
      if (!r) return r;
      const b = { rows: rowCount, cols: colCount, hidden };
      const f = clampCell(r.focus, b);
      const a = clampCell(r.anchor, b, f.col >= r.anchor.col ? 1 : -1); // toward the focus: no column joins the range
      const same = a.pos === r.anchor.pos && a.col === r.anchor.col && f.pos === r.focus.pos && f.col === r.focus.col;
      return same ? r : { anchor: a, focus: f };
    });
  }, [rowCount, colCount, hidden]);
  useEscapeSurface("selection", () => {
    setRange(null);
    return true;
  }, range !== null);

  /** Bounds from the LIVE row count: right after a commit grew the sheet the
   *  render-time `order` is one row short. */
  const bounds = (): GridBounds => {
    const live = liveShape(ds.id);
    const rows = Math.max(order.length, live?.rows ?? 0);
    return { rows: rows + (entryRow ? 1 : 0), cols: live?.cols ?? data.labels.length, hidden };
  };
  // Synchronous: the next key must already land on the grid, not on <body>.
  const focusGrid = () => document.getElementById(gridId)?.focus({ preventScroll: true });
  const place = (next: CellRange) => {
    setRange(next);
    setReveal((r) => ({ pos: next.focus.pos, column: next.focus.col, key: (r?.key ?? 0) - 1 })); // negative: never a row-reveal key
  };

  const onEditCell = (row: number, col: number, value: number) =>
    row >= data.time.length ? growAndSetCell(ds.id, row, col, value) : view.onEditCell(row, col, value);
  const xIsDate = data.metadata?.time_is_datetime === true; // a date X edits as dates (worksheet audit #7)
  const cellEdit = useCellEdit(
    onEditCell,
    (text) => setStatus(`"${text}" is not ${xIsDate ? "a number or date" : "a number"} — the cell was not changed`),
    xIsDate,
  );
  /** The original row at display `pos`; the entry row's is `order.length`. */
  const rowAt = (pos: number): number => order[pos] ?? order.length + (pos - order.length);
  const valueAt = (row: number, col: number) => (col < 0 ? data.time[row] : data.values[row]?.[col]);

  const startEdit = (typed?: string, from: CellRange | null = range) => {
    if (!from) return;
    const { pos, col } = from.focus;
    if (readOnly || col >= baseCount) {
      setStatus(col >= baseCount ? "a computed column is read-only — right-click its header › Set Column Values… to edit the formula" : ds.linkedCurves ? editRefusalNotice(ds) : "this worksheet is rebuilt from its source and can't be edited here");
      return;
    }
    cellEdit.startEdit(rowAt(pos), col, valueAt(rowAt(pos), col), typed);
  };

  cellEdit.onKey = (e) => {
    const k = e.key;
    if (k === "Escape") {
      e.preventDefault();
      cellEdit.cancel();
      focusGrid();
      return;
    }
    const delta: [number, number] | null =
      k === "Enter" ? [e.shiftKey ? -1 : 1, 0]
        : k === "Tab" ? [0, e.shiftKey ? -1 : 1]
          : cellEdit.mode === "enter" && ARROWS[k] ? ARROWS[k] : null;
    if (!delta) return;
    e.preventDefault();
    if (!cellEdit.commit()) return;
    if (range) place(moveCursor(range, delta[0], delta[1], false, bounds()));
    focusGrid();
  };

  // Cell-range block ops; the row × column selection's when there is no range.
  const cursorOps = useWorksheetBlockOps({
    datasetId: ds.id,
    rows: range ? rangeRows(range, order) : [],
    cols: range ? rangeCols(range, hidden) : [],
    order,
    rowCount: data.time.length,
    writableCols: baseCount,
    valueAt,
    levelsAt: (col) => categoricalLevels(data, col),
    setStatus,
  });
  const pasteAtCursor = () => {
    if (!range) return;
    if (readOnly) return view.blockOps.pasteBlock(); // refuses with the re-derived notice
    const { top, left } = rangeRect(range);
    void navigator.clipboard
      ?.readText()
      .then((text) => {
        const g = parseClipboardGrid(text);
        const w = g.reduce((m, r) => Math.max(m, r.length), 0);
        // Paste writes contiguous columns (as Excel does); copy/fill/clear skip hidden ones — say so.
        const intoHidden = Array.from({ length: w }, (_, i) => left + i).filter((c) => hidden.has(c)).length;
        setStatus(pasteGrowing(ds.id, text, top, left, order, entryRow) + (intoHidden ? ` — ${intoHidden} of the pasted columns are hidden` : ""));
        // Select what was pasted, as a spreadsheet does.
        if (g.length && w) setRange({ anchor: { pos: top, col: left }, focus: clampCell({ pos: top + g.length - 1, col: left + w - 1 }, bounds()) });
      })
      .catch(() => setStatus("clipboard read unavailable"));
  };
  const blockOps: BlockOpsApi = range ? { ...cursorOps, pasteBlock: pasteAtCursor } : view.blockOps;

  const onKeyDown = (e: React.KeyboardEvent): boolean => {
    // Only keys aimed at the grid itself: Enter on a focused toolbar button
    // must press that button, and a letter must not start a cell edit.
    if (isField(e.target) || !document.getElementById(gridId)?.contains(e.target as Node)) return false;
    const b = bounds();
    const accel = e.ctrlKey || e.metaKey;
    if (accel && e.key.toLowerCase() === "a" && b.rows > 0) {
      // Never a hidden column: select-all lands on the last SHOWN cell.
      const last = clampCell({ pos: Math.max(0, order.length - 1), col: b.cols - 1 }, b);
      // setRange, not place(): place() also raises a reveal, which would scroll
      // the view to the last cell. Select-all must leave the viewport alone,
      // and the active cell stays the one it was (the first cell if none),
      // moved onto the nearest shown column if that one has been hidden since.
      const full = { anchor: { pos: 0, col: -1 }, focus: last };
      const was = (all && all.range === range ? all.active : range) ?? cellAt({ pos: 0, col: -1 }, b);
      const f = clampCell(was.focus, b);
      setRange(full);
      setAll({ range: full, active: { anchor: f, focus: f } });
      return true;
    }
    if (!range) {
      // Keyboard entry into a grid that has focus but no cursor yet.
      if ((e.target as HTMLElement).id === gridId && (ARROWS[e.key] || e.key === "Enter" || e.key === "Tab")) {
        place(cellAt({ pos: 0, col: -1 }, b));
        return true;
      }
      return false;
    }
    const k = e.key;
    // Keys that move or edit act from the pre-select-all active cell and
    // collapse the selection to it; clear / copy / cut / fill keep the range.
    const fromAll = all && all.range === range && !accel && k !== "Delete" && k !== "Backspace" && k !== "Escape" && !["Shift", "Control", "Alt", "Meta"].includes(k);
    const cur = fromAll ? { anchor: clampCell(all.active.focus, b), focus: clampCell(all.active.focus, b) } : range;
    if (fromAll) setRange(cur);
    // A jump to the bottom lands on the last DATA row, as Ctrl+End does in a
    // spreadsheet — never on the blank entry row under it.
    const jb = { ...b, rows: Math.max(1, b.rows - (entryRow ? 1 : 0)) };
    if (ARROWS[k]) {
      const [dr, dc] = ARROWS[k];
      const edge = accel ? (dr < 0 ? "top" : dr > 0 ? "bottom" : dc < 0 ? "left" : "right") : null;
      place(edge ? jumpCursor(cur, edge, e.shiftKey, jb) : moveCursor(cur, dr, dc, e.shiftKey, b));
    } else if (k === "Home" || k === "End") {
      const r = accel ? jumpCursor(cur, k === "Home" ? "top" : "bottom", e.shiftKey, jb) : cur;
      place(jumpCursor(r, k === "Home" ? "left" : "right", e.shiftKey, b));
    } else if (k === "PageUp" || k === "PageDown") {
      place(moveCursor(cur, k === "PageUp" ? -PAGE : PAGE, 0, e.shiftKey, b));
    } else if (k === "Enter") {
      place(moveCursor(cur, e.shiftKey ? -1 : 1, 0, false, b));
    } else if (k === "Tab") {
      const next = moveCursor(cur, 0, e.shiftKey ? -1 : 1, false, b);
      // At the sheet's edge Tab leaves the grid, so keyboard users can move on.
      if (next.focus.col === cur.focus.col) return false;
      place(next);
    } else if (k === "F2" && e.shiftKey) {
      hooks.onEditHeader(cur.focus.col);
    } else if (k === "F2") {
      startEdit(undefined, cur);
    } else if (k === "ContextMenu" || (k === "F10" && e.shiftKey)) {
      const box = document.getElementById(cellId(cur.focus.pos, cur.focus.col))?.getBoundingClientRect();
      hooks.onColumnMenu(cur.focus.col, box ? box.left : 0, box ? box.bottom : 0);
    } else if (k === "Delete" || k === "Backspace") {
      cursorOps.clearBlock();
    } else if (accel && (k === "c" || k === "x" || k === "v" || k === "d")) {
      if (k === "c") cursorOps.copyBlock();
      else if (k === "x") cursorOps.cutBlock();
      else if (k === "v") pasteAtCursor();
      else cursorOps.fillDown();
    } else if (startsTyping(e)) {
      startEdit(e.key, cur);
    } else {
      return false;
    }
    return true;
  };

  const activeCell = range ? (all && all.range === range ? clampCell(all.active.focus, { rows: rowCount, cols: colCount, hidden }) : range.focus) : null;
  const grid: GridCursorProps = {
    gridId,
    label: `${ds.name} worksheet`,
    activeCellId: activeCell ? cellId(activeCell.pos, activeCell.col) : undefined,
    cellEdit,
    entryRow,
    entryRowIndex: order.length,
    cellId,
    mark: (pos, col) =>
      !range || !activeCell ? null : activeCell.pos === pos && activeCell.col === col ? "cursor" : inRange(range, pos, col) ? "range" : null,
    onCellDown: (pos, col, e) => {
      if (e.button !== 0) return;
      if (e.shiftKey && range) {
        e.preventDefault(); // no text selection on a shift-click
        setRange({ anchor: range.anchor, focus: { pos, col } });
      } else setRange({ anchor: { pos, col }, focus: { pos, col } });
      if (view.selectedCols.size) view.clearColSelection();
    },
    onCellEnter: (pos, col, e) => {
      if (e.buttons === 1 && range) setRange({ anchor: range.anchor, focus: { pos, col } });
    },
  };

  const goTo = (row: number, col: number) => {
    const pos = order.indexOf(row);
    if (pos >= 0 && !hidden.has(col)) place({ anchor: { pos, col }, focus: { pos, col } });
  };

  return { range, grid, blockOps, onKeyDown, clear: () => setRange(null), reveal, goTo };
}
