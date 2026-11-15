// Is a dataset's `data` RE-DERIVED by the recalc graph? Exactly the two cases
// store/recalcDatasets.ts rebuilds: a derived worksheet (`derivedFrom`, re-run
// from its source) and a corrected dataset (`corrections` + `raw`, re-run from
// `raw`). A direct value edit on either lands in `data` only and the next
// recalc silently throws it away, so store/cellEdit.ts refuses such edits with
// this notice. Computed (formula) columns and row exclusions are unaffected:
// both are regenerated/carried by the recalc, not lost by it.

import type { Dataset } from "./types";

/** A LIVE multi-dataset graph (`Dataset.linkedCurves`, lib/linkedCurves.ts) is
 *  a cache the watcher rebuilds from its source workbooks, so a value edit or
 *  formula column on it would be silently overwritten: same data-loss class,
 *  same refusal, different advice. */
export const LINKED_GRAPH_EDIT_NOTICE =
  "This graph's data comes from its source workbooks; edit the source, or Duplicate as a plain dataset to edit here";

export const REDERIVED_EDIT_NOTICE =
  "This dataset is recomputed from its source; edit the raw data or reset corrections first.";

export function isRederived(ds: Pick<Dataset, "derivedFrom" | "corrections" | "raw" | "linkedCurves">): boolean {
  return ds.linkedCurves != null || ds.derivedFrom != null || (ds.corrections != null && ds.raw != null);
}

/** The refusal text for a dataset `isRederived` says can't take data edits. */
export function editRefusalNotice(ds: Pick<Dataset, "linkedCurves">): string {
  return ds.linkedCurves != null ? LINKED_GRAPH_EDIT_NOTICE : REDERIVED_EDIT_NOTICE;
}
