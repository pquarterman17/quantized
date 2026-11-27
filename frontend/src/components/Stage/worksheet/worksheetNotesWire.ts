// The cell notes of an exported worksheet, laid out for io/table_export.py (plans/ROW_RANGE_CONTRACT.md 7.2,
// D15): `.xlsx` writes them as cell comments at the exported cell, CSV and TSV cannot carry them. Pure.

import { notesOf } from "../../../lib/cellNotes";
import type { Dataset } from "../../../lib/types";
import { worksheetTableColumns } from "./worksheetTable";

/** One note on the wire (routes/export_table.py `TableNote`): 0-based DATA row and column of the exported table. */
export interface TableNoteWire {
  row: number;
  col: number;
  text: string;
}

/** The notes of `ds` that land in the exported table: `rows` are the exported SOURCE rows in order, and the
 *  columns are the table's own (worksheet or file order, Disregard columns left out when asked). A note on a
 *  row or column that is not exported is not written. */
export function worksheetNotesWire(ds: Dataset, rows: readonly number[], skipDisregard = false): TableNoteWire[] {
  const notes = notesOf(ds.data.metadata);
  if (Object.keys(notes).length === 0) return [];
  const rowAt = new Map(rows.map((r, i) => [r, i]));
  const out: TableNoteWire[] = [];
  worksheetTableColumns(ds, skipDisregard).forEach((plan, col) => {
    if (plan.channel === undefined) return; // a text column carries no note
    for (const [r, text] of Object.entries(notes[String(plan.channel)] ?? {})) {
      const row = rowAt.get(Number(r));
      if (row !== undefined) out.push({ row, col, text });
    }
  });
  return out;
}
