// Is a dataset's `data` RE-DERIVED from somewhere else? Three cases: the two
// store/recalcDatasets.ts rebuilds -- a derived worksheet (`derivedFrom`,
// re-run from its source) and a corrected dataset (`corrections` + `raw`,
// re-run from `raw`) -- and a LIVE multi-dataset graph (`linkedCurves`,
// rebuilt from its source workbooks by store/linkedCurvesSync.ts). A direct
// value edit on any of them lands in `data` only and the next rebuild
// silently throws it away, so every data-editing entry point refuses such an
// edit with `rederivedNotice`. Computed (formula) columns and row exclusions
// are unaffected on the first two (regenerated/carried by the recalc), but a
// graph's columns ARE its curves: it takes no formula, error or statistics
// column either (gap audit 2 #1). Plot styling is view state and still works.

import type { Dataset } from "./types";

export const REDERIVED_EDIT_NOTICE =
  "This dataset is recomputed from its source; edit the raw data or reset corrections first.";

export const LINKED_GRAPH_EDIT_NOTICE =
  "This graph's data comes from its source workbooks; edit the source, or Duplicate as a plain dataset to edit here";

type Rederivable = Pick<Dataset, "derivedFrom" | "corrections" | "raw" | "linkedCurves">;

export function isRederived(ds: Rederivable): boolean {
  return ds.derivedFrom != null || (ds.corrections != null && ds.raw != null) || ds.linkedCurves != null;
}

/** Why `ds` refuses a data edit (call only when `isRederived(ds)`). */
export function rederivedNotice(ds: Pick<Dataset, "linkedCurves">): string {
  return ds.linkedCurves != null ? LINKED_GRAPH_EDIT_NOTICE : REDERIVED_EDIT_NOTICE;
}

/** True for a live multi-dataset graph -- its columns are its curves. */
export function isLinkedGraph(ds: Pick<Dataset, "linkedCurves"> | null | undefined): boolean {
  return ds?.linkedCurves != null;
}

/** Refuse a column/value edit on a graph: reports why and returns true. */
export function refuseLinkedGraph(ds: Pick<Dataset, "linkedCurves"> | null | undefined, report: (msg: string) => void): boolean {
  if (!isLinkedGraph(ds)) return false;
  report(LINKED_GRAPH_EDIT_NOTICE);
  return true;
}
