// A result table as the book shows it (lanes RB, RB3): the saved table in the
// saved book, the live table (the tool's own save builder) in a tool. One
// renderer so both read the same: numbers through fmtNum, empty cells as "—",
// the first PREVIEW_ROWS rows with a note when there are more.

/** The in-tool note: a live table is unbounded, the saved one may be cut. */
export const LIVE_REST = "These are the live rows; once saved, Copy, Send to report and Open as worksheet use the saved table, which the save may shorten.";

import type { AnalysisResultTable } from "../../../lib/analysisResult";
import { fmtNum } from "../../../lib/format";
import { DataTable } from "../../primitives/DataTable";

const PREVIEW_ROWS = 100;

/** The saved book's note: its actions use this same saved table. */
const SAVED_REST = "Copy and Open as worksheet use the complete table.";

/** `restNote`: what the actions use beyond the shown rows (a tool's live table
 *  differs: once saved, its actions use the saved, possibly shorter, table). */
export default function BookTable({ table, restNote = SAVED_REST }: { table: AnalysisResultTable; restNote?: string }) {
  return <>
    <DataTable columns={table.columns} rows={table.rows.slice(0, PREVIEW_ROWS).map((row) =>
      row.map((cell) => typeof cell === "number" ? fmtNum(cell) : (cell ?? "—")))} />
    {table.rows.length > PREVIEW_ROWS && <p className="qz-analysis-caption">
      Showing {PREVIEW_ROWS} of {table.rows.length} rows. {restNote}
    </p>}
  </>;
}
