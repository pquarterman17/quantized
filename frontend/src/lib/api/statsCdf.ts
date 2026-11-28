// The CDF plot's endpoint wrapper, in its own file because `stats.ts` sits at the
// 500-line module ceiling. Re-exported by `lib/api.ts`.

import type { CdfWire, CdfY } from "../statCdf";
import { HttpError, postJSON } from "./http";

/** The CDF plot's ECDF steps per column, with an optional DKW band and fitted
 *  CDF (`calc.statplots_cdf.cdf_series`). When the server cannot be reached (a
 *  network failure, not a refusal) the same numbers are computed here
 *  (`lib/statCdfLocal`) and the answer says so (`local`); a fitted CDF needs the
 *  server's maximum-likelihood fit and is refused with that reason. */
export async function statsCdf(
  columns: number[][],
  y: CdfY = "proportion",
  band = false,
  fit?: string | null,
): Promise<CdfWire & { local?: true }> {
  try {
    return await postJSON("/api/statplots/cdf", { columns, y, band, ...(fit ? { fit } : {}) });
  } catch (err) {
    if (err instanceof HttpError) throw err; // the server answered: its reason stands
    if (fit) throw new Error(`a fitted CDF needs the server (${err instanceof Error ? err.message : "not reachable"})`);
    return { ...(await import("../statCdfLocal")).cdfWireLocal(columns, y, band), local: true };
  }
}
