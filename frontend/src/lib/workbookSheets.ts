// Multi-sheet Excel workbooks (plot audit round 2): the import payload carries
// sheet 0 at the top level and every OTHER data sheet in `sheets`
// (src/quantized/io/excel_sheets.py). Each sheet becomes its own dataset in
// ONE workbook node (L0.3: every sheet of one source file stays a child of
// that file's workbook); `metadata.sheet_name` finds the same sheet again on
// re-import.

import type { DataStruct } from "./types";

/** The sheet a dataset was imported from, or null (not a workbook sheet). */
export function sheetNameOf(d: Pick<DataStruct, "metadata">): string | null {
  const raw = (d.metadata as Record<string, unknown> | undefined)?.sheet_name;
  return typeof raw === "string" && raw ? raw : null;
}

/** `data` and its other sheets as one list (primary first), with the
 *  `sheets` envelope removed from `data` so it never lands on a dataset. */
export function splitSheets(data: DataStruct): DataStruct[] {
  const rest = data.sheets ?? [];
  delete data.sheets;
  return [data, ...rest];
}

/** A sheet dataset's name: the file name alone for a one-sheet import, else
 *  `file:sheet` (the `stem:part` shape Origin books use). */
export function sheetDatasetName(fileName: string, d: DataStruct, count: number): string {
  const sheet = count > 1 ? sheetNameOf(d) : null;
  return sheet ? `${fileName}:${sheet}` : fileName;
}

/** The sheet of a freshly re-read multi-sheet payload that matches a dataset
 *  imported from sheet `sheet`. `undefined` = the file is no longer
 *  multi-sheet (use its top level, as before); throws when the sheet is gone. */
export function freshSheet(fresh: DataStruct, sheet: string | null): DataStruct | undefined {
  if (!fresh.sheets?.length || sheet == null) return undefined;
  const match = [fresh, ...fresh.sheets].find((d) => sheetNameOf(d) === sheet);
  if (!match) throw new Error(`sheet "${sheet}" no longer exists in the re-imported file`);
  return match;
}
