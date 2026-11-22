// One outlier screen of a value array as summary cells (lane BY): the same four
// backend tests the single run calls (useOutlierScreening), reduced to what a
// By-level or batch row reports. Screening only: nothing here selects or
// excludes rows; "Select flagged rows" stays a single-run action.

import { statsDixonQ, statsGrubbs, statsMadOutliers, statsRosner } from "../../../lib/api";
import type { OutlierMethod } from "./useOutlierScreening";

export interface OutlierSettings {
  method: OutlierMethod;
  alpha: number;
  k: number;
  threshold: number;
}

export const OUTLIER_SUMMARY_HEADERS = ["Finite N", "Flagged", "Flagged values"] as const;

/** How many flagged values a summary cell lists before "…". */
const SHOWN_VALUES = 5;

/** Screen `values` (finite and non-finite; each test drops non-finite itself)
 *  and return [finite N, flagged count, the first flagged values]. */
export async function screenSummary(values: number[], s: OutlierSettings): Promise<(string | number)[]> {
  const result = s.method === "grubbs" ? await statsGrubbs(values, s.alpha)
    : s.method === "rosner" ? await statsRosner(values, s.k, s.alpha)
      : s.method === "dixon-q" ? await statsDixonQ(values, s.alpha)
        : await statsMadOutliers(values, s.threshold);
  const flagged = result.flagged_indices.map((index) => values[index]!);
  const shown = flagged.slice(0, SHOWN_VALUES).map((value) => Number(value.toPrecision(6))).join(", ");
  return [
    values.length - result.excluded_indices.length,
    flagged.length,
    flagged.length > SHOWN_VALUES ? `${shown}, …` : flagged.length ? shown : "none",
  ];
}

/** The settings a saved row depends on (the method's own parameter only). */
export function outlierParameters(s: OutlierSettings): Record<string, string | number> {
  return s.method === "mad" ? { method: s.method, threshold: s.threshold }
    : s.method === "rosner" ? { method: s.method, alpha: s.alpha, k: s.k }
      : { method: s.method, alpha: s.alpha };
}
