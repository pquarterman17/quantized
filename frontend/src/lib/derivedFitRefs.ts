// P2.5 fitted-value use — (re)resolving a column's fitted-value snapshots
// against the dataset's saved fit. Lazy (the evaluator only READS snapshots,
// lib/formulaFitRefs.ts); reached from lib/derivedColumn.ts when a column is
// created and from store/derivedColumnRun.refreshFitRefsFor whenever a fit
// changes (setFitSpec, the recalc graph's refit, split).

import { children, parseExpr, type Node } from "./derivedExprAst";
import { fitModelExpr } from "./derivedFitModels";
import { recomputeWithErrors } from "./formula";
import { asAlreadyComputed } from "./formulaInputs";
import type { FitRefSnapshot } from "./formulaTypes";
import type { Dataset, FitSpec } from "./types";

function walk(n: Node, visit: (n: Node) => void): void {
  visit(n);
  for (const c of children(n)) walk(c, visit);
}

/** Every `fit()`/`fitval()` reference in `root`, resolved against `ds`'s
 *  CURRENT saved fit — the first-resolution pass a freshly analysed ƒx
 *  column runs (lib/derivedColumn.ts, which calls this the same way) and,
 *  per review finding 4, ALSO what an add/edit that has no snapshot yet
 *  (refreshFitRefs below) runs, so a model with no existing snapshot is not
 *  stuck unresolvable forever. */
export function resolveFits(ds: Dataset, root: Node): { fits: FitRefSnapshot[] } | { error: string } {
  const fits: FitRefSnapshot[] = [];
  let error: string | undefined;
  walk(root, (n) => {
    if (error || (n.k !== "fit" && n.k !== "fitval")) return;
    let s = fits.find((f) => f.model === n.model);
    if (!s) {
      const table = fitModelExpr(n.model);
      s = resnapFitRef(
        { model: n.model, paramNames: table ? [...table.params] : [], params: [], ...(table ? { expr: table.expr } : {}) },
        ds.fitSpec,
      );
      if (s.missing) return void (error = `${n.k}("${n.model}"): ${s.missing}`);
      fits.push(s);
    }
    if (n.k === "fitval" && !s.expr) {
      error = `fitval() can only evaluate a closed-form model (Gaussian, Lorentzian, Linear, …); "${n.model}" is not one`;
    } else if (n.k === "fit") {
      const named = s.paramNames.indexOf(n.param);
      const idx = named >= 0 ? named : /^p\d+$/.test(n.param) ? Number(n.param.slice(1)) : -1;
      if (idx < 0 || idx >= s.params.length) {
        const names = s.paramNames.length ? s.paramNames.join(", ") : s.params.map((_, i) => `p${i}`).join(", ");
        error = `the "${n.model}" fit has no parameter "${n.param}" (it has ${names})`;
      }
    }
  });
  return error ? { error } : { fits };
}

/** A formula whose text plainly reads like a fit()/fitval() reference — the
 *  cheap eager check every lazy-import guard in this feature shares (review
 *  finding 8), before parsing or importing anything. */
export const FIT_CALL_RE = /\bfit(val)?\(/;

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
 *  follows the new fit or errors with why it cannot. Returns the SAME dataset
 *  when no snapshot changed (no recompute, no store write). A column without
 *  fitted values keeps its existing error message: this pass cannot change
 *  it, and must not replace a more specific one (removeFormula's "references
 *  removed column X") with the evaluator's generic text. */
export function refreshFitRefs(d: Dataset): Dataset {
  const old = d.formulas ?? [];
  let changed = false;
  const formulas = old.map((f) => {
    if (!f.derived?.fits?.length) {
      // Finding 4: an add/edit that introduced fit()/fitval() for a model
      // never snapshotted before must still resolve — not just re-snap an
      // existing array — or it can never resolve at all.
      if (!FIT_CALL_RE.test(f.expr)) return f;
      let root: Node;
      try {
        root = parseExpr(f.expr);
      } catch {
        return f; // unparsable: its own compile error already says why
      }
      const resolved = resolveFits(d, root);
      if ("error" in resolved || !resolved.fits.length) return f;
      changed = true;
      return { ...f, derived: { ...(f.derived ?? {}), fits: resolved.fits } };
    }
    const fits = f.derived.fits.map((r) => resnapFitRef(r, d.fitSpec));
    if (JSON.stringify(fits) === JSON.stringify(f.derived.fits)) return f;
    changed = true;
    return { ...f, derived: { ...f.derived, fits } };
  });
  if (!changed) return d;
  // #7: the single recomputeWithErrors path (data+errors together, base
  // stripped once) — not a hand-rolled applyFormulas/formulaErrors pair —
  // so a recode column's level_order (carryComputedLevelOrder) survives a
  // refit exactly like it survives any other recompute.
  const { data, errors } = recomputeWithErrors(asAlreadyComputed(d.data), formulas);
  for (const f of formulas) {
    const before = d.formulaErrors?.[f.name];
    if (!f.derived?.fits?.length && before && errors[f.name]) errors[f.name] = before;
  }
  return { ...d, formulas, data, formulaErrors: Object.keys(errors).length ? errors : undefined };
}
