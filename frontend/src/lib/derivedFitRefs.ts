// P2.5 fitted-value use — (re)resolving a column's fitted-value snapshots
// against the dataset's saved fit. Lazy (the evaluator only READS snapshots,
// lib/formulaFitRefs.ts); reached from lib/derivedColumn.ts when a column is
// created and from store/derivedColumnRun.refreshFitRefsFor whenever a fit
// changes (setFitSpec, the recalc graph's refit, split).

import { applyFormulas, baseColumns, formulaErrors } from "./formula";
import type { FitRefSnapshot } from "./formulaTypes";
import type { Dataset, FitSpec } from "./types";

/** Re-resolve a snapshot against the dataset's CURRENT saved fit: its params
 *  when it is the same model, converged (`exitFlag` > 0 or absent) and
 *  complete, else none and `missing` saying why. Keeps the model's names and
 *  formula. The one rule the first resolution (lib/derivedColumn.ts) and every
 *  refresh (refreshFitRefs below) share. */
export function resnapFitRef(s: FitRefSnapshot, spec: FitSpec | undefined): FitRefSnapshot {
  const p = spec?.params ?? [];
  const ok =
    spec?.model === s.model && (spec.exitFlag ?? 1) > 0 && p.length > 0 && p.every(Number.isFinite) && (!s.paramNames.length || p.length === s.paramNames.length);
  const why = !spec ? "this dataset has no saved fit" : spec.model !== s.model ? `the saved fit is "${spec.model}"` : "the saved fit did not converge or has no usable parameters";
  return { model: s.model, paramNames: s.paramNames, ...(s.expr ? { expr: s.expr } : {}), params: ok ? [...p] : [], ...(ok ? {} : { missing: why }) };
}

/** Re-resolve every `fit()`/`fitval()` snapshot on a dataset's computed
 *  columns against its CURRENT saved fit and recompute them, so a column
 *  follows the new fit or errors with why it cannot. Same dataset back when
 *  it has none. */
export function refreshFitRefs(d: Dataset): Dataset {
  if (!d.formulas?.some((f) => f.derived?.fits?.length)) return d;
  const formulas = d.formulas.map((f) =>
    f.derived?.fits?.length ? { ...f, derived: { ...f.derived, fits: f.derived.fits.map((r) => resnapFitRef(r, d.fitSpec)) } } : f,
  );
  const base = baseColumns(d.data, formulas.length);
  const errors = formulaErrors(base, formulas);
  return { ...d, formulas, data: applyFormulas(base, formulas), formulaErrors: Object.keys(errors).length ? errors : undefined };
}
