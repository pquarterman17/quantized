// File › New workbook (worksheet audit #14): an empty worksheet to type into,
// the way Origin starts every session with Book1: an X column and one Y, 32
// blank rows — Origin's own default — and the Worksheet view opened on it with
// the cell cursor ready. Typing past the last row grows it
// (store/worksheetGrow.ts), Insert / Add New Column add columns
// (store/worksheetColumns.ts). One undo step removes it again (`addDataset`).
// Loaded on demand by the File command (commands/fileCommands.ts).

import type { DataStruct } from "../lib/types";
import { nextDatasetId, useApp } from "./useApp";

/** Origin's blank-book row count. */
export const NEW_WORKBOOK_ROWS = 32;

/** An empty two-column sheet, all blank. The value column is "A" and the X
 *  column "X" so the names match the letters formulas use (x, A, B, …) —
 *  Origin's own "A(X), B(Y)" would make "A" mean two different columns. */
export function blankWorksheetData(rows = NEW_WORKBOOK_ROWS): DataStruct {
  return {
    time: Array.from({ length: rows }, () => Number.NaN),
    values: Array.from({ length: rows }, () => [Number.NaN]),
    labels: ["A"],
    units: [""],
    metadata: { x_column_name: "X", x_column_unit: "" },
  };
}

/** The first free "BookN" name. */
export function nextBookName(taken: readonly string[]): string {
  const names = new Set(taken);
  let n = 1;
  while (names.has(`Book${n}`)) n++;
  return `Book${n}`;
}

/** Add a blank workbook and open its worksheet. Returns its dataset id. */
export function newWorkbook(): string {
  const s = useApp.getState();
  const id = nextDatasetId();
  const name = nextBookName(s.datasets.map((d) => d.name));
  s.addDataset({ id, name, data: blankWorksheetData() });
  useApp.setState({ worksheetId: id, stageTab: "worksheet" });
  s.setStatus(`new workbook "${name}" — click a cell and type; Enter moves down, Tab moves right`);
  return id;
}
