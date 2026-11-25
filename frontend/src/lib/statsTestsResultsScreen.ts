// Statistical-tests workshop — display table and plain-language conclusion for
// response screening (GAP_AUDIT_9 G26). Sibling of statsTestsResults.ts (which
// delegates here); pure. One table, tested pairs first by raw p, then the pairs
// that could not be tested with their reason. The bar chart / p-value plot is
// `TestOutput.screen`, drawn live by components/workshops/statstests/ScreenView;
// a saved result keeps the table.

import type { StatsTestResult } from "./api/statsTests";
import type { ResponseScreeningResult } from "./api/statsTestsScreen";
import type { Cell, TestOutput } from "./statsTestsResults";

export type ScreenTestResult = Extract<StatsTestResult, { id: "response-screening" }>;

/** What the workshop draws for a screening output. */
export type ScreenDisplay = { result: ResponseScreeningResult };

const METHOD_NAMES: Record<string, string> = {
  bh: "Benjamini-Hochberg", by: "Benjamini-Yekutieli", holm: "Holm", bonferroni: "Bonferroni",
};
const FDR = new Set(["bh", "by"]);

export function describeScreen(result: ScreenTestResult): TestOutput {
  const r = result.data;
  const name = METHOD_NAMES[r.method] ?? r.method;
  const level = `${Number((r.alpha * 100).toPrecision(3))}%`;
  const control = FDR.has(r.method) ? `false discovery rate ${level}` : `family-wise error rate ${level}`;
  const skipped = r.n_degenerate > 0 ? ` ${r.n_degenerate} pair${r.n_degenerate === 1 ? "" : "s"} could not be tested (reasons in the table).` : "";
  const sentence = `${r.n_significant} of ${r.n_tested} tested Y × X pairs are significant after ${name} adjustment (${control}).${skipped}`;
  const tested = r.results.filter((row) => row.p != null).sort((a, b) => (a.p as number) - (b.p as number));
  const rest = r.results.filter((row) => row.p == null);
  const adjName = `${name} p`;
  return {
    sentence,
    screen: { result: r },
    tables: [{
      title: "Screening results",
      columns: ["response", "factor", "test", "n", "effect type", "effect size", "estimate", "CI low", "CI high", "p", adjName, "LogWorth", "adjusted LogWorth", `significant at ${level}`, "note"],
      rows: [...tested, ...rest].map((x): Cell[] => [
        x.y, x.x, x.test ?? "not tested", x.n, x.effect_label, x.effect_size,
        x.estimate_label && x.estimate != null ? x.estimate : null, x.ci_low, x.ci_high, x.p, x.p_adjusted,
        x.logworth, x.adj_logworth, x.p == null ? "—" : x.significant ? "yes" : "no", x.reason ?? (x.estimate_label ?? ""),
      ]),
    }],
  };
}
