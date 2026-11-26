// The CDF plot's endpoint wrapper, in its own file because `stats.ts` sits at the
// 500-line module ceiling. Re-exported by `lib/api.ts`.

import type { CdfWire, CdfY } from "../statCdf";
import { postJSON } from "./http";

/** The CDF plot's ECDF steps per column, with an optional DKW band and fitted
 *  CDF (`calc.statplots_cdf.cdf_series`). */
export function statsCdf(
  columns: number[][],
  y: CdfY = "proportion",
  band = false,
  fit?: string | null,
): Promise<CdfWire> {
  return postJSON("/api/statplots/cdf", { columns, y, band, ...(fit ? { fit } : {}) });
}
