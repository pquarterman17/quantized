// The lazy-only half of lib/rederived.ts (bundle diet, plans/BUNDLE_HEADROOM.md
// slice 34): the re-derived test and the refusal text it picks. Every caller is
// a lazy edit body or worksheet component; the eager store keeps only the
// linked-graph notice. The code moved here verbatim and lib/rederived.ts
// re-exports it with `export *` - importers and tests are unchanged, and
// Rollup bundles this file with the lazy chunks that use it.
// architecture.test.ts ("re-exported lazy half") keeps eager modules off it.

import { LINKED_GRAPH_EDIT_NOTICE } from "./rederived";
import { PROTECTED_NOTICE } from "./sheetProtection";
import type { Dataset } from "./types";

export const REDERIVED_EDIT_NOTICE =
  "This dataset is recomputed from its source; edit the raw data or reset corrections first.";

// A PROTECTED sheet (lib/sheetProtection.ts) refuses exactly what a re-derived one does, so every edit path
// that already asks this question refuses a protected sheet too, with its own reason.
export function isRederived(ds: Pick<Dataset, "derivedFrom" | "corrections" | "raw" | "linkedCurves" | "protectedSheet">): boolean {
  return ds.protectedSheet === true || ds.linkedCurves != null || ds.derivedFrom != null || (ds.corrections != null && ds.raw != null);
}

/** The refusal text for a dataset `isRederived` says can't take data edits. */
export function editRefusalNotice(ds: Pick<Dataset, "linkedCurves" | "protectedSheet">): string {
  if (ds.protectedSheet === true) return PROTECTED_NOTICE;
  return ds.linkedCurves != null ? LINKED_GRAPH_EDIT_NOTICE : REDERIVED_EDIT_NOTICE;
}
