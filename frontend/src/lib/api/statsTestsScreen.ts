// Statistical-tests workshop wrappers, part six (GAP_AUDIT_9 G26): response
// screening. Request shape from the generated OpenAPI schema; the route
// returns a plain calc dict (non-finite values arrive as null).

import { postJSON } from "./http";
import type { components } from "./schema";

type S = components["schemas"];
type Num = number | null;

export interface ScreeningRow {
  y: string; x: string; x_kind: "continuous" | "nominal";
  test: string | null; n: number; n_levels: Num;
  effect_label: string | null; effect_size: Num;
  estimate_label: string | null; estimate: Num; ci_low: Num; ci_high: Num;
  statistic: Num; df: Num; p: Num; p_adjusted: Num;
  logworth: Num; adj_logworth: Num; significant: boolean; reason: string | null;
}

export interface ResponseScreeningResult {
  results: ScreeningRow[]; method: "bh" | "by" | "holm" | "bonferroni"; alpha: number;
  n_pairs: number; n_tested: number; n_degenerate: number; n_significant: number;
}

export const statsResponseScreening = (body: S["ResponseScreeningRequest"], signal?: AbortSignal): Promise<ResponseScreeningResult> =>
  postJSON("/api/stats/response-screening", body, signal);
