// POST /api/fitting/report (routes/fitting_report.py -> calc.fit_report):
// Origin NLFit-style inference for a finished fit — t, Prob>|t|, confidence
// limits, ANOVA, covariance/correlation and the statistics block. Only the
// Curve Fit report section (a lazy chunk) imports this. Non-finite values
// arrive as null.

import { postJSON } from "./http";
import type { components } from "./schema";

type Num = number | null;

export type FitReportRequest = components["schemas"]["FitReportRequest"];

export interface FitReportParam {
  value: Num;
  error: Num;
  t: Num;
  prob: Num;
  lcl: Num;
  ucl: Num;
}

export interface FitReportAnovaRow {
  source: "Regression" | "Residual" | "Uncorrected Total" | "Corrected Total";
  df: number;
  ss: Num;
  ms: Num;
  f: Num;
  prob: Num;
}

export interface FitReportResult {
  level: number;
  parameters: FitReportParam[];
  anova: FitReportAnovaRow[];
  covariance: Num[][] | null;
  correlation: Num[][] | null;
  stats: { n: number; dof: number; rss: Num; reducedChiSq: Num; R2: Num; adjR2: Num; rootMSE: Num };
}

export function fitReport(req: FitReportRequest, signal?: AbortSignal): Promise<FitReportResult> {
  return postJSON("/api/fitting/report", req, signal);
}
