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

import { useEffect, useId, useState } from "react";

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
import { isRederived, LINKED_GRAPH_EDIT_NOTICE } from "../../../lib/rederived";
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
  const { order, data, baseCount } = view;
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
      const b = { rows: rowCount, cols: colCount };
      const [a, f] = [clampCell(r.anchor, b), clampCell(r.focus, b)];
      const same = a.pos === r.anchor.pos && a.col === r.anchor.col && f.pos === r.focus.pos && f.col === r.focus.col;
      return same ? r : { anchor: a, focus: f };
    });
  }, [rowCount, colCount]);
  useEscapeSurface("selection", () => {
    setRange(null);
    return true;
  }, range !== null);

  /** Bounds from the LIVE row count: right after a commit grew the sheet the
   *  render-time `order` is one row short. */
  const bounds = (): GridBounds => {
    const live = liveShape(ds.id);
    const rows = Math.max(order.length, live?.rows ?? 0);
    return { rows: rows + (entryRow ? 1 : 0), cols: live?.cols ?? data.labels.length };
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

  const startEdit = (typed?: string) => {
    if (!range) return;
    const { pos, col } = range.focus;
    if (readOnly || col >= baseCount) {
      setStatus(col >= baseCount ? "a computed column is read-only — right-click its header › Set Column Values… to edit the formula" : ds.linkedCurves ? LINKED_GRAPH_EDIT_NOTICE : "this worksheet is rebuilt from its source and can't be edited here");
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
    cols: range ? rangeCols(range) : [],
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
        setStatus(pasteGrowing(ds.id, text, top, left, order, entryRow));
        // Select what was pasted, as a spreadsheet does.
        const g = parseClipboardGrid(text);
        const w = g.reduce((m, r) => Math.max(m, r.length), 0);
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
      const last = { pos: Math.max(0, order.length - 1), col: b.cols - 1 };
      place({ anchor: { pos: 0, col: -1 }, focus: last });
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
    // A jump to the bottom lands on the last DATA row, as Ctrl+End does in a
    // spreadsheet — never on the blank entry row under it.
    const jb = { ...b, rows: Math.max(1, b.rows - (entryRow ? 1 : 0)) };
    if (ARROWS[k]) {
      const [dr, dc] = ARROWS[k];
      const edge = accel ? (dr < 0 ? "top" : dr > 0 ? "bottom" : dc < 0 ? "left" : "right") : null;
      place(edge ? jumpCursor(range, edge, e.shiftKey, jb) : moveCursor(range, dr, dc, e.shiftKey, b));
    } else if (k === "Home" || k === "End") {
      const r = accel ? jumpCursor(range, k === "Home" ? "top" : "bottom", e.shiftKey, jb) : range;
      place(jumpCursor(r, k === "Home" ? "left" : "right", e.shiftKey, b));
    } else if (k === "PageUp" || k === "PageDown") {
      place(moveCursor(range, k === "PageUp" ? -PAGE : PAGE, 0, e.shiftKey, b));
    } else if (k === "Enter") {
      place(moveCursor(range, e.shiftKey ? -1 : 1, 0, false, b));
    } else if (k === "Tab") {
      const next = moveCursor(range, 0, e.shiftKey ? -1 : 1, false, b);
      // At the sheet's edge Tab leaves the grid, so keyboard users can move on.
      if (next.focus.col === range.focus.col) return false;
      place(next);
    } else if (k === "F2" && e.shiftKey) {
      hooks.onEditHeader(range.focus.col);
    } else if (k === "F2") {
      startEdit();
    } else if (k === "ContextMenu" || (k === "F10" && e.shiftKey)) {
      const box = document.getElementById(cellId(range.focus.pos, range.focus.col))?.getBoundingClientRect();
      hooks.onColumnMenu(range.focus.col, box ? box.left : 0, box ? box.bottom : 0);
    } else if (k === "Delete" || k === "Backspace") {
      cursorOps.clearBlock();
    } else if (accel && (k === "c" || k === "x" || k === "v" || k === "d")) {
      if (k === "c") cursorOps.copyBlock();
      else if (k === "x") cursorOps.cutBlock();
      else if (k === "v") pasteAtCursor();
      else cursorOps.fillDown();
    } else if (startsTyping(e)) {
      startEdit(e.key);
    } else {
      return false;
    }
    return true;
  };

  const grid: GridCursorProps = {
    gridId,
    label: `${ds.name} worksheet`,
    activeCellId: range ? cellId(range.focus.pos, range.focus.col) : undefined,
    cellEdit,
    entryRow,
    entryRowIndex: order.length,
    cellId,
    mark: (pos, col) =>
      !range ? null : range.focus.pos === pos && range.focus.col === col ? "cursor" : inRange(range, pos, col) ? "range" : null,
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

  return { range, grid, blockOps, onKeyDown, clear: () => setRange(null), reveal };
}
