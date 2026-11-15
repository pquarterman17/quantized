// Curve Fit — Global fit mode: the dataset-comparison verdict (Origin
// "Compare Datasets"): the extra-sum-of-squares F-test of a shared-parameter
// model against separate per-series fits, with each model's RSS / dof / AICc.

import { fmtNum as fmt } from "../../../lib/format";
import type { DatasetCompareResult as Comparison } from "../../../lib/api/globalFit";

export default function DatasetCompareResult({
  comparison,
  compareAll,
}: {
  comparison: Comparison | null;
  compareAll: boolean;
}) {
  if (!comparison) return null;
  const { test, shared, separate } = comparison;
  const separateWins = comparison.conclusion === "separate";
  const what = compareAll ? "all parameters" : comparison.sharedParams.join(", ");
  return (
    <div style={{ marginTop: 10 }} role="group" aria-label="Dataset comparison">
      <div className="qzk-ds-meta" style={{ fontWeight: 600 }}>
        {separateWins
          ? `Reject one shared value of ${what} — the series differ (p = ${fmt(test.p)})`
          : `One shared value of ${what} is adequate (p = ${fmt(test.p)})`}
      </div>
      <table className="qz-table" aria-label="Dataset comparison table" style={{ marginTop: 4 }}>
        <thead>
          <tr>
            <th>model</th>
            <th>RSS</th>
            <th>dof</th>
            <th>params</th>
            <th>AICc</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["shared", shared],
            ["separate", separate],
          ].map(([name, m]) => {
            const row = m as Comparison["shared"];
            return (
              <tr key={name as string}>
                <td>{name as string}</td>
                <td>{fmt(row.rss)}</td>
                <td>{row.df}</td>
                <td>{row.nParams}</td>
                <td>{fmt(row.aicc)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
        F({test.dfNum}, {test.dfDen}) = {fmt(test.F)} · extra-sum-of-squares, 5 % level
      </div>
    </div>
  );
}
