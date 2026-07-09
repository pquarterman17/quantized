// Double-click-to-edit state for the worksheet grid: at most one cell editing
// at a time across the WHOLE grid (matching today's behaviour, and simpler
// than per-row state now that rows are separately-rendered windowed items).
// Enter/blur commits via `onCommit`; Escape cancels without committing.
// Extracted from the old WorksheetTable's local `edit`/`draft` state
// (WORKSHEET_PLAN item 2) so GridRow stays a thin renderer.

import { useState } from "react";

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

export function useCellEdit(onCommit: (row: number, col: number, value: number) => void): CellEditApi {
  const [target, setTarget] = useState<CellEditTarget | null>(null);
  const [draft, setDraft] = useState("");

  return {
    target,
    draft,
    setDraft,
    isEditing: (row, col) => target != null && target.row === row && target.col === col,
    startEdit: (row, col, current) => {
      setTarget({ row, col });
      setDraft(current != null && Number.isFinite(current) ? String(current) : "");
    },
    commit: () => {
      if (!target) return;
      // Blank -> NaN (a deliberate "missing" marker); otherwise parse the number.
      const v = draft.trim() === "" ? Number.NaN : Number(draft);
      onCommit(target.row, target.col, v);
      setTarget(null);
    },
    cancel: () => setTarget(null),
  };
}
