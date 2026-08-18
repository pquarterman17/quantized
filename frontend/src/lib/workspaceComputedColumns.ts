// LIBRARY_WORKBOOK_UX_PLAN PR K (K2/K5b): .dwk (de)serialize for the two new
// Dataset fields the recalc-dependency foundation adds — `formulaErrors` and
// `derivedFrom`. Split out of lib/workspace.ts (which sits at its own
// general .ts ceiling pin, architecture.test.ts's TS_MODULE_PINS) the same
// way `sanitizeFilter`/`sanitizeBindings`/`sanitizeExcluded` already are:
// this module owns "serialize additively, degrade rather than throw on
// anything stale or hand-edited on load" for these two; workspace.ts just
// calls the two functions below (one call site each).

import type { Dataset } from "./types";

/** The `formulaErrors`/`derivedFrom` slice of a serialized dataset entry —
 *  spread into `serializeWorkspace`'s per-dataset object alongside every
 *  other optional field there. */
export function serializeComputedColumnsExtras(
  d: Pick<Dataset, "formulaErrors" | "derivedFrom">,
): Partial<Pick<Dataset, "formulaErrors" | "derivedFrom">> {
  return {
    ...(d.formulaErrors && Object.keys(d.formulaErrors).length ? { formulaErrors: d.formulaErrors } : {}),
    ...(d.derivedFrom ? { derivedFrom: d.derivedFrom } : {}),
  };
}

/** Validate + apply a parsed dataset entry's `formulaErrors`/`derivedFrom`
 *  onto `ds` in place — both degrade to "field absent" on anything
 *  malformed rather than throwing (a stale/hand-edited .dwk shouldn't fail
 *  to load over an additive, re-derivable field). */
export function applyComputedColumnsExtras(ds: Dataset, dd: Record<string, unknown>): void {
  if (dd.formulaErrors && typeof dd.formulaErrors === "object") {
    const errs: Record<string, string> = {};
    for (const [k, v] of Object.entries(dd.formulaErrors as Record<string, unknown>)) {
      if (typeof v === "string") errs[k] = v;
    }
    if (Object.keys(errs).length) ds.formulaErrors = errs;
  }
  const df = dd.derivedFrom as Record<string, unknown> | undefined;
  if (df && typeof df === "object" && typeof df.datasetId === "string" && typeof df.pipeline === "string") {
    ds.derivedFrom = { datasetId: df.datasetId, pipeline: df.pipeline };
  }
}
