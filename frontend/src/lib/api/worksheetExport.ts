// `POST /api/export/worksheet` (routes/export_table.py): a worksheet table ->
// CSV / TSV / Excel download. Its own module, imported only by the lazy export
// body (commands/worksheetExport.ts), so it never reaches the eager bundle.

import { postDownload } from "./http";

export type WorksheetExportFormat = "csv" | "tsv" | "xlsx";
export type TableColumnKind = "number" | "text" | "datetime";

/** One exported column (routes/export_table.py `TableColumn`): numbers, text,
 *  or a date column's epoch seconds; null for a blank cell. */
export interface TableColumnWire {
  name: string;
  unit: string;
  kind: TableColumnKind;
  cells: (number | string | null)[];
}

export interface WorksheetExportSheet {
  name: string;
  columns: TableColumnWire[];
  /** Cell notes, written as Excel comments (routes/export_table.py `TableNote`); CSV and TSV drop them. */
  notes?: { row: number; col: number; text: string }[];
}

export function exportWorksheetTable(
  body: { sheets: WorksheetExportSheet[]; fmt: WorksheetExportFormat; header: boolean; filename: string },
  signal?: AbortSignal,
): Promise<void> {
  return postDownload("/api/export/worksheet", body, `${body.filename}.${body.fmt}`, signal);
}
