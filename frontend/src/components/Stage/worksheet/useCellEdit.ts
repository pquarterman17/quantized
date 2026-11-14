// Double-click-to-edit state for the worksheet grid: at most one cell editing
// at a time across the WHOLE grid (matching today's behaviour, and simpler
// than per-row state now that rows are separately-rendered windowed items).
// Enter/blur commits via `onCommit`; Escape cancels without committing.
// Extracted from the old WorksheetTable's local `edit`/`draft` state
// (WORKSHEET_PLAN item 2) so GridRow stays a thin renderer.

import { useState } from "react";
import { fmtDateCell } from "./cellFormat";

export interface CellEditTarget {
  row: number;
  /** -1 = the x/time column. */
  col: number;
}

export interface CellEditApi {
  target: CellEditTarget | null;
  draft: string;
  setDraft: (v: string) => void;
  isEditing: (row: number, col: number) => boolean;
  startEdit: (row: number, col: number, current: number | undefined) => void;
  commit: () => void;
  cancel: () => void;
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
export function useCellEdit(onCommit: (row: number, col: number, value: number) => void, xIsDate = false): CellEditApi {
  const [target, setTarget] = useState<CellEditTarget | null>(null);
  const [draft, setDraft] = useState("");
  const isDate = (col: number) => xIsDate && col < 0;

  return {
    target,
    draft,
    setDraft,
    isEditing: (row, col) => target != null && target.row === row && target.col === col,
    startEdit: (row, col, current) => {
      setTarget({ row, col });
      const shown = isDate(col) ? fmtDateCell(current) : String(current);
      setDraft(current != null && Number.isFinite(current) ? shown : "");
    },
    commit: () => {
      if (!target) return;
      // Blank -> NaN (a deliberate "missing" marker); otherwise parse the number.
      const v = isDate(target.col) ? parseDateCell(draft) : draft.trim() === "" ? Number.NaN : Number(draft);
      onCommit(target.row, target.col, v);
      setTarget(null);
    },
    cancel: () => setTarget(null),
  };
}
