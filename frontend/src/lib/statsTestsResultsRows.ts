// Statistical-tests workshop — display tables and the plain-language reading for
// row-wise t-tests and the Mann-Kendall trend test. Sibling of
// statsTestsResults.ts (which delegates here); pure. Tables hold raw numbers.

import type { StatsTestResult } from "./api/statsTests";
import { ADJUST_NAMES, P_ADJUSTED, SOURCE_ROW, hasAdjusted, rowTLayout, sourceRowNumber } from "./rowTestWorksheet";
import type { Cell, ResultTable, TestOutput } from "./statsTestsResults";

export type RowsTestResult = Extract<StatsTestResult, { id: "row-t-tests" | "mann-kendall" }>;

type Num = number | null | undefined;
const isNum = (v: Num): v is number => v != null && Number.isFinite(v);
const num = (v: Num): string => (isNum(v) ? String(Number(v.toPrecision(3))) : "—");
const level = (alpha: number): string => `${Number((alpha * 100).toPrecision(3))}%`;
const fmtP = (p: Num): string => (!isNum(p) ? "p = —" : p < 1e-4 ? "p < 0.0001" : `p = ${Number(p.toPrecision(2))}`);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** `sourceRows`: the original worksheet row behind each analysis-view row (`rowstate.analysisRowIds`), so the "source row" column names the true row. */
export function describeRows(result: RowsTestResult, labels: string[], alpha: number, sourceRows?: readonly number[] | null): TestOutput {
  if (result.id === "mann-kendall") {
    const r = result.data;
    const [xName = "x", yName = "the values"] = labels;
    const ci = `${level(1 - r.alpha)} CI [${num(r.sen_ci_low)}, ${num(r.sen_ci_high)}]`;
    const head = r.significant
      ? `${fmtP(r.p)}: ${yName} shows a significant ${r.trend} trend over ${xName} at the ${level(alpha)} level`
      : `${fmtP(r.p)}: no evidence of a monotonic trend in ${yName} over ${xName} at the ${level(alpha)} level`;
    return {
      sentence: `${head} (S = ${r.S}, Z = ${num(r.Z)}; Sen's slope ${num(r.sen_slope)} per unit of ${xName}, ${ci}).`,
      tables: [{
        columns: ["statistic", "value"],
        rows: [
          ["n", r.n], ["S", r.S], ["Var(S) (tie-corrected)", r.var_S], ["Z (continuity-corrected)", r.Z], ["p (two-sided)", r.p],
          ["Kendall's tau (tau-b)", r.tau], ["Sen's slope", r.sen_slope], ["slope CI low", r.sen_ci_low], ["slope CI high", r.sen_ci_high],
          ["Sen's intercept", r.sen_intercept], ["tied value groups", r.n_tie_groups],
        ],
      }],
    };
  }
  const r = result.data;
  const adjusted = hasAdjusted(r);
  const layout = rowTLayout(r.design, adjusted);
  const untested = r.rows.filter((x) => x.status !== "ok");
  const hits = r.rows.filter((x) => isNum(x.p) && x.p < alpha).length;
  const rows = r.rows.map((x): Cell[] => [sourceRowNumber(x.row, sourceRows), ...layout.cells(x), ...(untested.length ? [x.status] : [])]);
  const table: ResultTable = {
    title: "Row-wise t-tests",
    columns: [SOURCE_ROW, ...layout.labels, ...(untested.length ? ["status"] : [])],
    rows,
  };
  const tail = untested.length ? ` ${plural(untested.length, "row", "rows")} could not be tested (see the status column).` : "";
  const adjHits = r.rows.filter((x) => isNum(x.p_adjusted) && x.p_adjusted < alpha).length;
  const note = adjusted
    ? `the "${P_ADJUSTED}" column corrects for testing ${r.n_tested} rows (${ADJUST_NAMES[r.adjust ?? "none"]}); ${adjHits} ${adjHits === 1 ? "stays" : "stay"} below ${alpha} after the correction, and the raw p is kept`
    : `each row is its own test, so these p-values are not adjusted for testing ${r.n_tested} rows`;
  return {
    sentence: `${r.method}: ${r.n_tested} of ${plural(r.n_rows, "row", "rows")} tested; ${hits} ${hits === 1 ? "has" : "have"} p < ${alpha} (${note}).${tail}`,
    tables: [table],
  };
}
