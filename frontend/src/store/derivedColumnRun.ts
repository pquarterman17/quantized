// P2.5 derived expressions — the lazy glue between the worksheet ƒx bar (or a
// replayed recipe step) and the store. It analyses the expression against the
// dataset as it is NOW (lib/derivedColumn.ts: syntax, columns, fitted values,
// unit, optional propagated σ) and commits the result:
//   - the value column, then its σ column when asked, appended like any
//     computed column (store/computedColumns.withRecomputedFormulas);
//   - the σ bound as the value column's symmetric Y error (P1.6 roles; the
//     label-guessed roles are made explicit first so none is lost), pushed to
//     every bound plot window like an Inspector edit;
//   - ONE undo entry and ONE recorded `expression` step (`derived: true`, so a
//     replay re-derives against its own target rather than trusting letters).
// A cycle refuses with zero mutation, as addFormula does. Lazy — and the body
// of the commit lives here, not in the eager slice — so the unit algebra, the
// expression tree and symbolic differentiation stay out of the eager bundle.

import { deriveColumns } from "../lib/derivedColumn";
import { refreshFitRefs } from "../lib/derivedFitRefs";
import { inferErrorBindings } from "../lib/errorRoles";
import { baseColumns, referencedColumns } from "../lib/formula";
import { lit } from "../lib/macro";
import { recalcNodes, wouldCreateCycle } from "../lib/recalc";
import type { ComputedColumn } from "../lib/types";
import { formulaLetter, withRecomputedFormulas } from "./computedColumns";
import { refusePendingEdit } from "./pendingEdit";
import { useApp } from "./useApp";
import { syncDatasetWindowDocuments } from "./windowDocuments";

export type DerivedColumnResult = { ok: true; message: string } | { ok: false; error: string };

/** Append analysed columns as one undoable, recorded step. False on a cycle. */
export function commitDerivedColumns(
  id: string,
  columns: ComputedColumn[],
  step: { name: string; expr: string; propagate: boolean },
): boolean {
  const get = useApp.getState;
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds || !columns.length || refusePendingEdit(get, ds, "adding a column")) return false;
  const count = ds.formulas?.length ?? 0;
  const added = columns.map((c) => ({ ...c, deps: referencedColumns(c.expr).letters }));
  for (const [i, c] of added.entries()) {
    const to = recalcNodes.column(id, formulaLetter(ds.data.labels.length, count, count + i));
    for (const dep of c.deps) {
      const reason = wouldCreateCycle(get().datasets, { from: recalcNodes.column(id, dep), to });
      if (reason) {
        get().setStatus(`Can't add column "${c.name}": ${reason}`);
        return false;
      }
    }
  }
  const bind = added.length > 1;
  get().recordHistory("add column");
  useApp.setState((s) => {
    const datasets = s.datasets.map((d) => {
      if (d.id !== id) return d;
      const formulas: ComputedColumn[] = [...(d.formulas ?? []), ...added];
      const next = { ...d, formulas, ...withRecomputedFormulas(baseColumns(d.data, d.formulas?.length ?? 0), formulas) };
      if (!bind) return next;
      const width = next.data.labels.length;
      const binding = { channel: width - 1, target: width - 2, axis: "y" as const, side: "both" as const };
      return { ...next, errorRoles: [...(d.errorRoles ?? inferErrorBindings(d.data)), binding] };
    });
    const roles = datasets.find((d) => d.id === id)?.errorRoles;
    return { datasets, ...(bind ? { plotWindows: syncDatasetWindowDocuments(s.plotWindows, id, roles) } : {}) };
  });
  get().recordMacro(
    `Add column ${step.name}`,
    `qz.addColumn(${lit(step.name)}, ${lit(step.expr)}${step.propagate ? ", { errors: true }" : ""})`,
    {
      kind: "expression",
      params: { name: step.name, expr: step.expr, derived: true, ...(step.propagate ? { propagate: true, sigmaName: added[1]?.name } : {}) },
    },
  );
  get().touchDataset(id); // recalc graph (#1): data changed
  return true;
}

/** Resolve the dataset's full data, analyse `req` against it, and commit. */
export async function addDerivedColumn(
  id: string,
  req: { name: string; expr: string; propagate: boolean },
): Promise<DerivedColumnResult> {
  const ds = await useApp.getState().resolveDataset(id);
  if (!ds) return { ok: false, error: "that dataset is no longer open" };
  let r: ReturnType<typeof deriveColumns>;
  try {
    r = deriveColumns(ds, req);
  } catch (e) {
    // The analysis only runs on text the evaluator accepted; a throw here is
    // a bug, reported as a refusal rather than an unhandled rejection.
    return { ok: false, error: `could not analyse the formula: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!r.ok) return r;
  const [value, sigma] = r.columns;
  if (!commitDerivedColumns(id, r.columns, { name: value.name, expr: value.expr, propagate: req.propagate }))
    return { ok: false, error: `could not add column "${value.name}" (see the status bar)` };
  const unit = r.unit ? ` [${r.unit}]` : r.dimensionless ? " [dimensionless]" : "";
  const withSigma = sigma ? ` with "${sigma.name}" bound as its error` : "";
  const notes = r.notes.length ? ` — ${r.notes.join("; ")}` : "";
  return { ok: true, message: `added column "${value.name}"${unit}${withSigma}${notes}` };
}

/** P2.5: re-resolve dataset `id`'s fitted-value columns against its current
 *  saved fit (store/computedColumns.refreshFitRefsLater schedules this). No
 *  undo entry of its own: it follows the fit change that caused it. */
export function refreshFitRefsFor(id: string): void {
  const d = useApp.getState().datasets.find((x) => x.id === id);
  const next = d && refreshFitRefs(d);
  if (next && next !== d) useApp.setState((s) => ({ datasets: s.datasets.map((x) => (x.id === id ? refreshFitRefs(x) : x)) }));
}
