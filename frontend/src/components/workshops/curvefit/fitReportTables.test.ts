// The fit-report tables (audit #6): what the panel shows is exactly what Copy
// (TSV) and Save CSV write, file-derived parameter names are formula-
// neutralized, and the matrices appear only with a covariance.

import { describe, expect, it } from "vitest";

import type { FitReportResult } from "../../../lib/api/fitReport";
import { tablesToCSV, tablesToTSV } from "../../../lib/statsTestsResults";
import { parameterTable, pctLabel, reportTables } from "./fitReportTables";

const REP: FitReportResult = {
  level: 0.9,
  parameters: [
    { value: 2, error: 0.1, t: 20, prob: 1e-9, lcl: 1.8, ucl: 2.2 },
    { value: 1, error: null, t: null, prob: null, lcl: null, ucl: null },
  ],
  anova: [
    { source: "Regression", df: 2, ss: 100, ms: 50, f: 500, prob: 1e-12 },
    { source: "Residual", df: 8, ss: 0.8, ms: 0.1, f: null, prob: null },
    { source: "Uncorrected Total", df: 10, ss: 100.8, ms: null, f: null, prob: null },
    { source: "Corrected Total", df: 9, ss: 40, ms: null, f: null, prob: null },
  ],
  covariance: [[0.01, 0], [0, 0]],
  correlation: [[1, null], [null, null]],
  stats: { n: 10, dof: 8, rss: 0.8, reducedChiSq: 0.1, R2: 0.98, adjR2: 0.975, rootMSE: 0.316 },
};

describe("fit report tables", () => {
  it("labels the confidence limits with the chosen level", () => {
    expect(pctLabel(0.95)).toBe("95%");
    expect(pctLabel(0.68)).toBe("68%");
    expect(parameterTable(["m", "b"], REP).columns).toEqual([
      "Parameter", "Value", "Standard Error", "t-Value", "Prob>|t|", "LCL (90%)", "UCL (90%)",
    ]);
  });

  it("lists parameters, statistics, ANOVA and both matrices in order", () => {
    const tables = reportTables(["m", "b"], REP, true);
    expect(tables.map((t) => t.title)).toEqual([
      "Parameters", "Statistics (weighted)", "ANOVA", "Covariance matrix", "Correlation matrix",
    ]);
    expect(tables[2]!.rows.map((r) => r[0])).toEqual(["Regression", "Residual", "Uncorrected Total", "Corrected Total"]);
    expect(tables[1]!.rows).toContainEqual(["Reduced χ²", 0.1]);
    expect(tables[1]!.rows).toContainEqual(["Adj. R²", 0.975]);
  });

  it("omits the matrices when the fit has no covariance", () => {
    const tables = reportTables(["m", "b"], { ...REP, covariance: null, correlation: null }, false);
    expect(tables.map((t) => t.title)).toEqual(["Parameters", "Statistics", "ANOVA"]);
  });

  it("TSV and CSV neutralize a formula-like parameter name", () => {
    const tables = [parameterTable(["=cmd()", "b"], REP)];
    expect(tablesToTSV(tables)).toContain("'=cmd()");
    expect(tablesToCSV(tables)).toContain("'=cmd()");
    expect(tablesToTSV(tables).split("\n")[2]!.split("\t")).toEqual(["'=cmd()", "2", "0.1", "20", "1e-9", "1.8", "2.2"]);
  });
});
