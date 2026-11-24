// Fit Model > LS-means comparisons (JMP Effect Details > LSMeans Differences):
// all pairs of one categorical effect's least-squares means, by Tukey HSD
// (default), Student's t (unadjusted) or Bonferroni. The server computes it from
// the fitted model alone (POST /api/stats/fit-model/compare); a method change
// refetches.

import { useEffect, useState } from "react";

import { statsFitModelCompare, type CompareMethod, type FitModelCompare as Compared } from "../../../lib/api/statsModel";
import type { AnalysisResultTable } from "../../../lib/analysisResult";
import { fmtNum } from "../../../lib/format";
import { Select } from "../../primitives";
import BookTable from "../resultbook/BookTable";
import type { FitModelResponse } from "../../../lib/api/statsModel";

const METHODS: { value: CompareMethod; label: string }[] = [
  { value: "tukey", label: "All pairs, Tukey HSD" },
  { value: "student", label: "Each pair, Student's t (unadjusted)" },
  { value: "bonferroni", label: "All pairs, Bonferroni" },
];

export function compareTable(c: Compared): AnalysisResultTable {
  const ci = `${fmtNum((1 - c.alpha) * 100)}%`;
  const pName = c.method === "student" ? "Prob > |t|" : "Adjusted Prob > |t|";
  return {
    title: `LS-means comparisons: ${c.effect}`,
    columns: ["Level", "- Level", "Difference", "Std Error", "DF", "t Ratio", pName, `Lower ${ci}`, `Upper ${ci}`],
    rows: c.rows.map((r) => [r.level_a, r.level_b, r.difference, r.se, r.df, r.t, r.p, r.lower, r.upper]),
  };
}

export default function FitModelCompare({ fit, factors }: { fit: FitModelResponse; factors: string[] }) {
  const [method, setMethod] = useState<CompareMethod>("tukey");
  const [state, setState] = useState<{ key: string; result?: Compared; error?: string } | null>(null);
  const key = `${factors.join("*")}|${method}|${fit.alpha}|${fit.model.coefficients.join(",")}`;
  useEffect(() => {
    const controller = new AbortController();
    statsFitModelCompare(fit.model, factors, method, fit.alpha, controller.signal).then(
      (result) => { if (!controller.signal.aborted) setState({ key, result }); },
      (e: unknown) => { if (!controller.signal.aborted) setState({ key, error: e instanceof Error ? e.message : "comparison failed" }); },
    );
    return () => controller.abort();
  }, [fit.model, fit.alpha, factors, key, method]);
  const current = state?.key === key ? state : null;
  return (
    <div>
      <Select aria-label="Comparison method" options={METHODS} value={method}
        onChange={(e) => setMethod(e.target.value as CompareMethod)} />
      {!current && <p className="qz-analysis-caption">comparing…</p>}
      {current?.error && <p className="qz-analysis-caption" role="alert">{current.error}</p>}
      {current?.result && <>
        <BookTable table={compareTable(current.result)} restNote="" />
        <p className="qz-analysis-caption">
          {current.result.pairs} pair(s) of {current.result.cells} cells on {current.result.df} error df;
          {method === "student" ? " p values are not adjusted for the number of pairs." : " p values and intervals are adjusted for all pairs."}
        </p>
      </>}
    </div>
  );
}
