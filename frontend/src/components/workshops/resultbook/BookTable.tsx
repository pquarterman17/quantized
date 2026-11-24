// A result table as the book shows it (lanes RB, RB3): the saved table in the
// saved book, the live table (the tool's own save builder) in a tool. One
// renderer so both read the same: numbers through fmtNum, empty cells as "—",
// the first PREVIEW_ROWS rows with a note when there are more.

import type { AnalysisResultTable } from "../../../lib/analysisResult";
import { fmtNum } from "../../../lib/format";
import { DataTable } from "../../primitives/DataTable";

const PREVIEW_ROWS = 100;

export default function BookTable({ table }: { table: AnalysisResultTable }) {
  return <>
    <DataTable columns={table.columns} rows={table.rows.slice(0, PREVIEW_ROWS).map((row) =>
      row.map((cell) => typeof cell === "number" ? fmtNum(cell) : (cell ?? "—")))} />
    {table.rows.length > PREVIEW_ROWS && <p className="qz-analysis-caption">
      Showing {PREVIEW_ROWS} of {table.rows.length} rows. Copy and Open as worksheet use the complete table.
    </p>}
  </>;
}
