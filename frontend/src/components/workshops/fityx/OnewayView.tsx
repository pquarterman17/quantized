// Fit Y by X — oneway leg's view: categorical X x continuous Y. Grouped
// points, per-group descriptive stats, plain one-way ANOVA, a Levene warning
// (equal-variance assumption), Tukey HSD when >2 levels, and the
// recommend_test chooser surfaced as a plain-language hint line.

import { fmtNum } from "../../../lib/format";
import { DataTable } from "../../primitives/DataTable";
import { StatusDot } from "../../primitives";
import GroupedStrip from "./GroupedStrip";
import type { OnewayResult } from "./useFitYByX";

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

function sd(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export default function OnewayView({ result }: { result: OnewayResult }) {
  const { groups, anova, levene, tukey, recommend } = result;
  const unequalVariance = levene != null && Number(levene.p) < 0.05;

  return (
    <>
      <GroupedStrip groups={groups} />

      <div style={{ marginTop: 10, overflowX: "auto" }}>
        <DataTable
          columns={["Group", "n", "mean", "sd"]}
          rows={groups.map((g) => [g.label, g.values.length, fmtNum(mean(g.values)), fmtNum(sd(g.values))])}
        />
      </div>

      <div style={{ marginTop: 10, overflowX: "auto" }}>
        <DataTable
          columns={["F", "df1", "df2", "p", "reject H0"]}
          rows={[[
            fmtNum(anova.fStat),
            String(anova.df1),
            String(anova.df2),
            fmtNum(anova.pValue),
            anova.reject ? "yes" : "no",
          ]]}
        />
      </div>

      <div style={{ marginTop: 8 }}>
        {levene ? (
          <StatusDot
            tone={unequalVariance ? "warn" : "ok"}
            label={
              unequalVariance
                ? `Levene: unequal variances (p=${fmtNum(levene.p)}) — ANOVA's equal-variance assumption is shaky`
                : `Levene: variances consistent with equal (p=${fmtNum(levene.p)})`
            }
          />
        ) : (
          <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
            Levene unavailable (every group needs ≥ 2 observations)
          </span>
        )}
      </div>

      {tukey && Array.isArray(tukey.pairs) && (
        <div style={{ marginTop: 10, overflowX: "auto" }}>
          <div className="qzk-field-lbl">Tukey HSD (all pairs)</div>
          <DataTable
            columns={["A", "B", "diff", "p", "CI low", "CI high", "sig."]}
            rows={(tukey.pairs as { i: number; j: number; diff: number; p: number; ciLow: number; ciHigh: number; significant: boolean }[]).map(
              (pr) => [
                groups[pr.i]?.label ?? String(pr.i),
                groups[pr.j]?.label ?? String(pr.j),
                fmtNum(pr.diff),
                fmtNum(pr.p),
                fmtNum(pr.ciLow),
                fmtNum(pr.ciHigh),
                pr.significant ? "yes" : "no",
              ],
            )}
          />
        </div>
      )}

      {recommend && (
        <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
          Test chooser: {recommend.recommendation} ({recommend.endpoint.replace("/api/stats/", "")})
          {recommend.reasons.length > 0 && ` — ${recommend.reasons[0]}`}
        </div>
      )}
    </>
  );
}
