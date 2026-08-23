// Default split-column picker for the "Split by column value…" dialog
// (MAIN_PLAN #26), split out of `lib/datasetsplit.ts` (2026-08-23, C2 bundle
// pass — see `frontend/scripts/check-bundle-size.mjs`'s header for the
// ratchet this split feeds). Every other export in `lib/datasetsplit.ts` is
// reachable from `store/split.ts`'s eager `splitColumn`/`tooManyGroups`/
// `sliceDataStruct` call chain; this one function is reached ONLY from the
// (lazy) `SplitDatasetDialog` picking its initial column suggestion, and
// isn't called by anything in that eager chain, so it doesn't need to live
// in the same always-loaded file.

import { splitColumn } from "./datasetsplit";
import type { DataStruct } from "./types";

/** Cheap "how setpoint-like is this column" score for the dialog's default
 *  column pick — LOWER is better; `Infinity` marks a column that can't
 *  usefully split (≤1 group: nothing to split, or every row its own
 *  group would be worse than useless). Fewer groups reads as more
 *  setpoint-like (a 4-level temperature column beats a near-continuous
 *  field column, which groups into hundreds under the same math). */
function setpointScore(data: DataStruct, col: number): number {
  const n = splitColumn(data, col).groups.length;
  return n > 1 ? n : Infinity;
}

/** Pick a sensible default split column for the dialog (MAIN_PLAN #26):
 *  the value channel whose cheap grouping looks most setpoint-like (fewest
 *  groups, so long as it splits into more than one) — e.g. a 4-level
 *  temperature column beats a near-continuous field column. Falls back to
 *  the FIRST value channel when nothing looks setpoint-like (every column
 *  is single-valued or highly fragmented — `setpointScore` is `Infinity`
 *  for all of them). Never the x/time column: a PPMS/MPMS-style export
 *  loops the SAME x sweep (e.g. field) once per setpoint, so x itself is
 *  essentially never the split key. Returns a channel index (0-based,
 *  into `DataStruct.values`), or -1 if `data` has no channels at all (a
 *  degenerate/empty dataset — the caller should disable the picker). */
export function pickDefaultSplitColumn(data: DataStruct): number {
  const n = data.labels.length;
  if (n === 0) return -1;
  let best = 0;
  let bestScore = Infinity;
  for (let c = 0; c < n; c++) {
    const score = setpointScore(data, c);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}
