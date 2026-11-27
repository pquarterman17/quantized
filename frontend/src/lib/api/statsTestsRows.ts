// Statistical-tests workshop wrappers, part seven: row-wise t-tests and the
// Mann-Kendall trend test (Origin feature-gap item 8). Request shapes come from
// the generated OpenAPI schema; the routes return plain calc dicts (non-finite
// values arrive as null).

import { postJSON } from "./http";
import type { components } from "./schema";

type S = components["schemas"];
type Num = number | null;

export interface RowTRow {
  row: number; n1: number; n2: number; mean1: Num; mean2: Num; diff: Num; se: Num;
  t: Num; df: Num; p: Num; ci_low: Num; ci_high: Num;
  /** "ok", or why this row was not tested. */
  status: string;
}

export interface RowTTestsResult {
  rows: RowTRow[]; n_rows: number; n_tested: number;
  design: "two-sample" | "one-sample" | "paired";
  /** Null unless the design is two-sample. */
  variance: "pooled" | "welch" | null;
  mu: number; alpha: number; alternative: "two-sided" | "less" | "greater"; method: string;
}

export interface MannKendallResult {
  n: number; S: number; var_S: number; Z: number; p: number; tau: number;
  sen_slope: number; sen_ci_low: number; sen_ci_high: number; sen_intercept: number;
  n_tie_groups: number; alpha: number; significant: boolean;
  trend: "increasing" | "decreasing" | "no trend"; method: string;
}

export const statsRowTTests = (body: S["RowTTestRequest"], signal?: AbortSignal): Promise<RowTTestsResult> =>
  postJSON("/api/stats/row-t-tests", body, signal);

export const statsMannKendall = (body: S["MannKendallRequest"], signal?: AbortSignal): Promise<MannKendallResult> =>
  postJSON("/api/stats/mann-kendall", body, signal);
