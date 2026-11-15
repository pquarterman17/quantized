// The stacked-panel plot's error spans (see stackErrorSpans). Its own module so
// the eager per-series-X view (lib/perSeriesX.ts) stays small.
//
// Pure.

import { buildErrorSpans, type ErrorSpan } from "./errorbars";
import { perSeriesXData } from "./perSeriesX";
import type { Dataset } from "./types";

export { buildErrorColumns } from "./errorbars";

/** The stacked-panel plot's error spans, one map per fetched channel. Each stack
 *  panel is a single-series plot over THIS per-series-X view (one block of rows
 *  per X), so its spans are built from the same view -- from the source rows
 *  they would cover only the first block and leave a secondary-X curve's bars
 *  misaligned. */
export function stackErrorSpans(active: Dataset, xKey: number | null, channels: readonly number[]): Map<number, ErrorSpan[]>[] {
  const roles = active.errorRoles;
  if (!roles?.length) return [];
  const data = perSeriesXData(active, xKey)?.data ?? active.data;
  return channels.map((ch) => buildErrorSpans(data, [ch], roles));
}
