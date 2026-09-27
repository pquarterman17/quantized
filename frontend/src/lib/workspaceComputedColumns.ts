// LIBRARY_WORKBOOK_UX_PLAN PR K (K2/K5b): .dwk (de)serialize for the two new
// Dataset fields the recalc-dependency foundation adds — `formulaErrors` and
// `derivedFrom`. Split out of lib/workspace.ts (which sits at its own
// general .ts ceiling pin, architecture.test.ts's TS_MODULE_PINS) the same
// way `sanitizeFilter`/`sanitizeBindings`/`sanitizeExcluded` already are:
// this module owns "serialize additively, degrade rather than throw on
// anything stale or hand-edited on load" for these two; workspace.ts just
// calls the two functions below (one call site each).

import type { FitRefSnapshot } from "./formulaTypes";
import type { ComputedColumn, Dataset } from "./types";

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

const strings = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((s) => typeof s === "string") ? (v as string[]) : undefined;

/** P2.5: a computed column's `derived` record (lib/formulaTypes.ts
 *  DerivedSpec) as read back from a .dwk — every field re-typed, anything
 *  malformed dropped, so a hand-edited file cannot feed the evaluator a
 *  non-array `params` or a σ link without its formula. A dropped fit snapshot
 *  makes the column error ("not resolved"); a dropped σ link leaves a plain
 *  formula. Never throws. */
export function sanitizeDerived(raw: unknown): ComputedColumn["derived"] {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: NonNullable<ComputedColumn["derived"]> = {};
  if (r.unitAuto === true) out.unitAuto = true;
  const notes = strings(r.notes);
  if (notes?.length) out.notes = notes;
  if (Array.isArray(r.fits)) {
    const fits = r.fits.flatMap((f): FitRefSnapshot[] => {
      const s = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
      const names = strings(s.paramNames);
      const params = Array.isArray(s.params) && s.params.every((p) => typeof p === "number") ? (s.params as number[]) : undefined;
      if (typeof s.model !== "string" || !names || !params) return [];
      const opt = (k: "expr" | "missing") => (typeof s[k] === "string" ? { [k]: s[k] as string } : {});
      return [{ model: s.model, paramNames: names, params, ...opt("expr"), ...opt("missing") }];
    });
    if (fits.length) out.fits = fits;
  }
  const so = r.sigmaOf as Record<string, unknown> | undefined;
  if (so && typeof so === "object" && typeof so.name === "string") out.sigmaOf = { name: so.name, method: "first-order, uncorrelated" };
  if (typeof r.sigma === "string") out.sigma = r.sigma;
  return Object.keys(out).length ? out : undefined;
}
