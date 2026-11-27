// Row-wise t-tests: the columns of the per-row result, shared by the result
// table (statsTestsResultsRows.ts) and the worksheet the "Add as worksheet"
// action commits, so the two cannot disagree. Pure.
//
// One output row per input row of the analysis view, in the same order, with
// the source's X column as its X. A row that could not be tested has NaN
// (worksheet) / null (table) statistics, never a dropped row.

import type { RowTAdjust, RowTRow, RowTTestsResult } from "./api/statsTestsRows";
import type { DataStruct } from "./types";

type Design = RowTTestsResult["design"];
type Layout = { labels: string[]; cells: (r: RowTRow) => (number | null)[] };

/** The multiple-comparison options for the per-row p column ("none" adds no column). */
export const ROWT_ADJUSTMENTS: readonly { id: RowTAdjust; label: string }[] = [
  { id: "none", label: "None (raw p only)" },
  { id: "bonferroni", label: "Bonferroni (p x m)" },
  { id: "holm", label: "Holm (step-down)" },
  { id: "bh", label: "Benjamini-Hochberg (false discovery rate)" },
];
export const ADJUST_NAMES: Readonly<Record<RowTAdjust, string>> = {
  none: "none", bonferroni: "Bonferroni", holm: "Holm", bh: "Benjamini-Hochberg",
};

/** Name of the adjusted-p column: it sits right after the raw `p`, which it never replaces. */
export const P_ADJUSTED = "p (adjusted)";

const tail = (adjusted: boolean): Layout => ({
  labels: ["SE", "t", "df", "p", ...(adjusted ? [P_ADJUSTED] : []), "CI low", "CI high"],
  cells: (r) => [r.se, r.t, r.df, r.p, ...(adjusted ? [r.p_adjusted ?? null] : []), r.ci_low, r.ci_high],
});

const HEAD: Readonly<Record<Design, Layout>> = {
  "two-sample": { labels: ["n A", "n B", "mean A", "mean B", "difference"], cells: (r) => [r.n1, r.n2, r.mean1, r.mean2, r.diff] },
  "one-sample": { labels: ["n", "mean"], cells: (r) => [r.n1, r.mean1] },
  paired: { labels: ["pairs", "mean difference"], cells: (r) => [r.n1, r.mean1] },
};

/** The result columns for a design; `adjusted` adds the adjusted-p column (the result asked for one). */
export function rowTLayout(design: Design, adjusted: boolean): Layout {
  const head = HEAD[design];
  const t = tail(adjusted);
  return { labels: [...head.labels, ...t.labels], cells: (r) => [...head.cells(r), ...t.cells(r)] };
}

export const hasAdjusted = (result: RowTTestsResult): boolean => (result.adjust ?? "none") !== "none";

export const SOURCE_ROW = "source row";

/** The 1-based source worksheet row of analysis-view row `i`: `sourceRows` is
 *  `rowstate.analysisRowIds` (the original row behind each kept row), null when
 *  nothing is dropped and the view is the worksheet. */
export const sourceRowNumber = (i: number, sourceRows?: readonly number[] | null): number => (sourceRows ? sourceRows[i] ?? i : i) + 1;

/** The committed worksheet: X = the source's X per row, one channel per result column. */
export function rowTestWorksheet(
  result: RowTTestsResult, xs: readonly number[], xLabel: string, xUnit: string, sourceRows?: readonly number[] | null,
): DataStruct {
  const layout = rowTLayout(result.design, hasAdjusted(result));
  const labels = [SOURCE_ROW, ...layout.labels];
  return {
    time: [...xs],
    values: result.rows.map((r, i) => [sourceRowNumber(i, sourceRows), ...layout.cells(r).map((v) => (typeof v === "number" ? v : NaN))]),
    labels,
    units: labels.map(() => ""),
    metadata: { x_column_name: xLabel, x_unit: xUnit, source: "row-t-tests", row_t_method: result.method },
  };
}
