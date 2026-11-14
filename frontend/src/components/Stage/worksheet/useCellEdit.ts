// Cell-edit state for the worksheet grid: at most one cell editing at a time
// across the WHOLE grid (simpler than per-row state now that rows are
// separately-rendered windowed items). Enter/blur commits via `onCommit`;
// Escape cancels without committing. Extracted from the old WorksheetTable's
// local `edit`/`draft` state (WORKSHEET_PLAN item 2) so GridRow stays a thin
// renderer.
//
// Two ways in, as in Origin and every spreadsheet: TYPING over a cell starts
// an "enter" edit (the keystroke replaces the value, and an arrow key commits
// and moves on), while F2 or a double-click starts an "edit" edit (the value is
// kept, and the arrows move the caret). The grid's cell cursor
// (./useGridCursor.ts) installs `onKey` to make Enter/Tab/arrows move it.
//
// A non-number typed into a numeric cell is REFUSED, not written: it used to
// become a silent blank (Number("abc") is NaN, the "missing" marker).

import { useRef, useState } from "react";

import { parseCell } from "../../../lib/clipboardGrid";
import { fmtDateCell } from "./cellFormat";

export interface CellEditTarget {
  row: number;
  /** -1 = the x/time column. */
  col: number;
}

export type CellEditMode = "enter" | "edit";

export interface CellEditApi {
  target: CellEditTarget | null;
  draft: string;
  setDraft: (v: string) => void;
  /** How the edit started — see the module doc. */
  mode: CellEditMode;
  isEditing: (row: number, col: number) => boolean;
  /** `typed` replaces the value (type-to-edit, "enter" mode); without it the
   *  current value is kept for editing ("edit" mode). */
  startEdit: (row: number, col: number, current: number | undefined, typed?: string) => void;
  /** Commit the draft; false (editor left open) when it is not a number. */
  commit: () => boolean;
  cancel: () => void;
  /** The editor's keydown, when a cell cursor drives it (Enter/Tab/arrows
   *  move the cursor); absent → Enter commits and Escape cancels. */
  onKey?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

/** A typed date/time (`2026-03-01 12:00`, ISO `T`/`Z` forms) as UTC epoch
 *  seconds, the timestamp column's storage; NaN when it is not a date. A bare
 *  number is taken as epoch seconds as before. */
export function parseDateCell(text: string): number {
  const s = text.trim();
  if (s === "") return Number.NaN;
  if (Number.isFinite(Number(s))) return Number(s);
  const iso = s.replace(" ", "T");
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) || !iso.includes("T") ? iso : `${iso}Z`);
  return Number.isFinite(ms) ? ms / 1000 : Number.NaN;
}

/** `xIsDate`: the x column (-1) holds timestamps, edited as dates (audit #7). */
export function useCellEdit(
  onCommit: (row: number, col: number, value: number) => void,
  onReject?: (text: string) => void,
  xIsDate = false,
): CellEditApi {
  const [target, setTarget] = useState<CellEditTarget | null>(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<CellEditMode>("edit");
  const isDate = (col: number) => xIsDate && col < 0;
  // The edit as of RIGHT NOW, not as of the last render: a key that commits
  // and then moves focus back to the grid blurs the editor synchronously,
  // and that blur must see the edit already closed — or it commits twice.
  const live = useRef<CellEditTarget | null>(null);
  const close = () => {
    live.current = null;
    setTarget(null);
  };

  return {
    target,
    draft,
    setDraft,
    mode,
    isEditing: (row, col) => live.current != null && live.current.row === row && live.current.col === col,
    startEdit: (row, col, current, typed) => {
      live.current = { row, col };
      setTarget({ row, col });
      setMode(typed === undefined ? "edit" : "enter");
      const shown = isDate(col) ? fmtDateCell(current) : String(current);
      setDraft(typed ?? (current != null && Number.isFinite(current) ? shown : ""));
    },
    commit: () => {
      const at = live.current;
      if (!at) return true;
      // Blank -> NaN (a deliberate "missing" marker); otherwise the number,
      // read the way a paste reads it ("1,500" yes, "1,5" or "abc" no).
      const v = isDate(at.col) ? parseDateCell(draft) : parseCell(draft);
      if (v === null || (isDate(at.col) && Number.isNaN(v) && draft.trim() !== "")) {
        onReject?.(draft);
        return false;
      }
      close();
      onCommit(at.row, at.col, v);
      return true;
    },
    cancel: close,
  };
}
