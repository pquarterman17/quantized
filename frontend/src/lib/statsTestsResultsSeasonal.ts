// Statistical-tests workshop — display tables and plain-language reading for the
// seasonal Mann-Kendall trend test. Pure; tables hold raw numbers.

import type { StatsTestResult } from "./api/statsTests";
import type { ResultTable, TestOutput } from "./statsTestsResults";

export type SeasonalTestResult = Extract<StatsTestResult, { id: "seasonal-mann-kendall" }>;

type Num = number | null | undefined;
const isNum = (v: Num): v is number => v != null && Number.isFinite(v);
const num = (v: Num): string => (isNum(v) ? String(Number(v.toPrecision(3))) : "—");
const level = (alpha: number): string => `${Number((alpha * 100).toPrecision(3))}%`;
const fmtP = (p: Num): string => (!isNum(p) ? "p = —" : p < 1e-4 ? "p < 0.0001" : `p = ${Number(p.toPrecision(2))}`);

export function describeSeasonal(result: SeasonalTestResult, labels: string[], alpha: number): TestOutput {
  const r = result.data;
  const [xName = "time", yName = "the values", seasonName = "season"] = labels;
  const ci = `${level(1 - r.alpha)} CI [${num(r.sen_ci_low)}, ${num(r.sen_ci_high)}]`;
  const head = r.significant
    ? `${fmtP(r.p)}: ${yName} shows a significant ${r.trend} trend over ${xName}, within each ${seasonName}, at the ${level(alpha)} level`
    : `${fmtP(r.p)}: no evidence of a monotonic trend in ${yName} over ${xName}, within each ${seasonName}, at the ${level(alpha)} level`;
  const skipped = r.skipped_seasons.length
    ? ` ${r.skipped_seasons.length} ${r.skipped_seasons.length === 1 ? "season was" : "seasons were"} left out for having fewer than 2 observations (see the table below).`
    : "";
  const tables: ResultTable[] = [
    {
      columns: ["statistic", "value"],
      rows: [
        ["n", r.n], ["seasons used", r.n_seasons], ["within-season pairs", r.n_pairs], ["S", r.S], ["Var(S) (tie-corrected, seasons independent)", r.var_S],
        ["Z (continuity-corrected)", r.Z], ["p (two-sided)", r.p], ["seasonal Sen's slope", r.sen_slope], ["slope CI low", r.sen_ci_low],
        ["slope CI high", r.sen_ci_high], ["Sen's intercept", r.sen_intercept],
      ],
    },
    {
      title: "Seasons",
      columns: [seasonName, "n", "S", "Var(S)", "tied value groups", "Sen's slope"],
      rows: r.seasons.map((s) => [s.season, s.n, s.S, s.var_S, s.tie_groups, s.sen_slope]),
    },
  ];
  if (r.skipped_seasons.length) {
    tables.push({ title: "Seasons left out", columns: [seasonName, "n", "reason"], rows: r.skipped_seasons.map((s) => [s.season, s.n, s.reason]) });
  }
  return {
    sentence: `${head} (S = ${r.S}, Z = ${num(r.Z)}; seasonal Sen's slope ${num(r.sen_slope)} per unit of ${xName}, ${ci}).${skipped}`,
    tables,
  };
}
