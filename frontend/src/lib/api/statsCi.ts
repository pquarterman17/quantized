// `/api/stats/confidence-intervals`: the Distribution workshop's confidence-
// interval panel. Own file so the lazy panel is the only importer.

import { postJSON } from "./http";

export interface CiRow {
  statistic: string;
  method: string;
  estimate: number;
  low: number | null;
  high: number | null;
  /** The coverage the interval actually has (the median's is exact, not the requested level). */
  level: number;
  note: string | null;
  rank_low?: number | null;
  rank_high?: number | null;
}

export interface CiResult {
  rows: CiRow[];
  n: number;
  n_dropped: number;
  level: number;
  bootstrap: { seed: number; resamples: number } | null;
}

export const statsConfidenceIntervals = (
  x: readonly number[], level: number, bootstrap: boolean, signal?: AbortSignal,
): Promise<CiResult> => postJSON("/api/stats/confidence-intervals", { x, level, bootstrap }, signal);
