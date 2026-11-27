// Row-wise t-tests: the columns of the per-row result, shared by the result
// table (statsTestsResultsRows.ts) and the worksheet the "Add as worksheet"
// action commits, so the two cannot disagree. Pure.
//
// One output row per input row of the analysis view, in the same order, with
// the source's X column as its X. A row that could not be tested has NaN
// (worksheet) / null (table) statistics, never a dropped row.

import type { RowTRow, RowTTestsResult } from "./api/statsTestsRows";
import type { DataStruct } from "./types";

type Design = RowTTestsResult["design"];
type Layout = { labels: string[]; cells: (r: RowTRow) => (number | null)[] };

const TAIL = (r: RowTRow): (number | null)[] => [r.se, r.t, r.df, r.p, r.ci_low, r.ci_high];
const TAIL_LABELS = ["SE", "t", "df", "p", "CI low", "CI high"];

/** The result columns per design. */
export const ROWT_LAYOUT: Readonly<Record<Design, Layout>> = {
  "two-sample": {
    labels: ["n A", "n B", "mean A", "mean B", "difference", ...TAIL_LABELS],
    cells: (r) => [r.n1, r.n2, r.mean1, r.mean2, r.diff, ...TAIL(r)],
  },
  "one-sample": {
    labels: ["n", "mean", ...TAIL_LABELS],
    cells: (r) => [r.n1, r.mean1, ...TAIL(r)],
  },
  paired: {
    labels: ["pairs", "mean difference", ...TAIL_LABELS],
    cells: (r) => [r.n1, r.mean1, ...TAIL(r)],
  },
};

/** The committed worksheet: X = the source's X per row, one channel per result column. */
export function rowTestWorksheet(result: RowTTestsResult, xs: readonly number[], xLabel: string, xUnit: string): DataStruct {
  const layout = ROWT_LAYOUT[result.design];
  return {
    time: [...xs],
    values: result.rows.map((r) => layout.cells(r).map((v) => (typeof v === "number" ? v : NaN))),
    labels: [...layout.labels],
    units: layout.labels.map(() => ""),
    metadata: { x_column_name: xLabel, x_unit: xUnit, source: "row-t-tests", row_t_method: result.method },
  };
}
