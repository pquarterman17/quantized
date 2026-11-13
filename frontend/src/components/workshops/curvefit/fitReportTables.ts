// Curve Fit — the NLFit-style report as plain tables (pure: no React/store).
//
// One shape (`ResultTable`, lib/statsTestsResults) feeds the panel's tables
// AND its Copy (TSV) / Save CSV, so what is copied is exactly what is shown.
// Cells stay numbers here; the panel formats them for display and the
// serializers (formula-neutralized text cells) write them in full precision.

import type { FitReportResult } from "../../../lib/api/fitReport";
import type { Cell, ResultTable } from "../../../lib/statsTestsResults";

/** Confidence levels offered for the parameter limits (95% default). */
export const REPORT_LEVELS = [0.68, 0.9, 0.95, 0.99] as const;

export const pctLabel = (level: number): string => `${+(level * 100).toFixed(2)}%`;

/** The parameter table: value, SE, t, Prob>|t| and the level's limits. */
export function parameterTable(names: readonly string[], rep: FitReportResult): ResultTable {
  const lv = pctLabel(rep.level);
  return {
    title: "Parameters",
    columns: ["Parameter", "Value", "Standard Error", "t-Value", "Prob>|t|", `LCL (${lv})`, `UCL (${lv})`],
    rows: rep.parameters.map((p, i): Cell[] => [names[i] ?? `p${i}`, p.value, p.error, p.t, p.prob, p.lcl, p.ucl]),
  };
}

export function statisticsTable(rep: FitReportResult, weighted: boolean): ResultTable {
  const s = rep.stats;
  return {
    title: weighted ? "Statistics (weighted)" : "Statistics",
    columns: ["Statistic", "Value"],
    rows: [
      ["Number of points", s.n],
      ["Degrees of freedom", s.dof],
      ["Residual sum of squares", s.rss],
      ["Reduced χ²", s.reducedChiSq],
      ["R² (COD)", s.R2],
      ["Adj. R²", s.adjR2],
      ["Root-MSE (SD)", s.rootMSE],
    ],
  };
}

export function anovaTable(rep: FitReportResult): ResultTable {
  return {
    title: "ANOVA",
    columns: ["Source", "DF", "Sum of Squares", "Mean Square", "F Value", "Prob>F"],
    rows: rep.anova.map((a): Cell[] => [a.source, a.df, a.ss, a.ms, a.f, a.prob]),
  };
}

function matrixTable(title: string, names: readonly string[], m: (number | null)[][] | null): ResultTable | null {
  if (!m || m.length !== names.length) return null;
  return { title, columns: ["", ...names], rows: m.map((row, i): Cell[] => [names[i]!, ...row]) };
}

/** Every report table in display order (matrices only when the fit has a covariance). */
export function reportTables(names: readonly string[], rep: FitReportResult, weighted: boolean): ResultTable[] {
  const out = [parameterTable(names, rep), statisticsTable(rep, weighted), anovaTable(rep)];
  const cov = matrixTable("Covariance matrix", names, rep.covariance);
  const cor = matrixTable("Correlation matrix", names, rep.correlation);
  if (cov) out.push(cov);
  if (cor) out.push(cor);
  return out;
}
