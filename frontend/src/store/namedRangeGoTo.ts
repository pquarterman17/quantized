// "Go to" a named range: put its cells in view and selected. On the sheet the caller is showing (`local`), the rows and
// columns are selected as a block (the worksheet's own row and column selection, which Plot selection, Use as row
// range and Analyze selection then act on). From anywhere else (the manager, another sheet's Name box) the range's
// worksheet is opened with its rows selected and its first column revealed and selected. A range that cannot be read
// now (stale, broken) is refused with the reason: it never selects a guess.

import { namedRangeIssue, type NamedRange } from "../lib/namedRanges";
import { useApp } from "./useApp";
import { openedWorksheetWindowId, openWorksheet } from "./worksheetOpen";
import { useWorksheetReveal } from "./worksheetReveal";

/** The worksheet pane the Name box lives in, as far as selecting is concerned. */
export interface LocalSheet {
  datasetId: string;
  windowId?: string;
  /** Drop the cell cursor (a row or column selection takes over). */
  clearCursor: () => void;
  setRows: (rows: number[]) => void;
  setCols: (cols: number[]) => void;
}

const rowsOf = (range: NamedRange): number[] => {
  const rows = range.target.rows;
  return rows ? Array.from({ length: rows.to - rows.from + 1 }, (_v, i) => rows.from + i) : [];
};

/** Select `range`; returns the reason it could not, or null. */
export function goToNamedRange(range: NamedRange, local?: LocalSheet): string | null {
  const app = useApp.getState();
  const issue = namedRangeIssue(range, app.datasets);
  if (issue) {
    app.setStatus(issue);
    return issue;
  }
  const { datasetId, cols, rows } = range.target;
  const column = cols[0];
  if (local && local.datasetId === datasetId) {
    local.clearCursor();
    local.setRows(rowsOf(range));
    local.setCols(cols);
    // Scroll only: the selection above is the range's whole block, not the one row a reveal would pick.
    useWorksheetReveal.getState().requestRowReveal({ datasetId, row: rows?.from ?? 0, column, windowId: local.windowId, select: false });
  } else {
    openWorksheet({ datasetId, rowIds: rowsOf(range) });
    useWorksheetReveal.getState().requestRowReveal({
      datasetId,
      row: rows?.from ?? -1,
      column,
      selectColumn: true,
      windowId: openedWorksheetWindowId(datasetId),
      select: rows !== null,
    });
  }
  useApp.getState().setStatus(`selected named range "${range.name}"`);
  return null;
}
