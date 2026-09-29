// Is a dataset's `data` RE-DERIVED by the recalc graph? Exactly the two cases
// store/recalcDatasets.ts rebuilds: a derived worksheet (`derivedFrom`, re-run
// from its source) and a corrected dataset (`corrections` + `raw`, re-run from
// `raw`). A direct value edit on either lands in `data` only and the next
// recalc silently throws it away, so store/cellEdit.ts refuses such edits with
// this notice. Computed (formula) columns and row exclusions are unaffected:
// both are regenerated/carried by the recalc, not lost by it.

import type { Dataset } from "./types";

export const REDERIVED_EDIT_NOTICE =
  "This dataset is recomputed from its source; edit the raw data or reset corrections first.";

export function isRederived(ds: Pick<Dataset, "derivedFrom" | "corrections" | "raw">): boolean {
  return ds.derivedFrom != null || (ds.corrections != null && ds.raw != null);
}
