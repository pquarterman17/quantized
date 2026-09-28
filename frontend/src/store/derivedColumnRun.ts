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

import { deriveColumns, type DeriveRequest } from "../lib/derivedColumn";
import { inferErrorBindings } from "../lib/errorRoles";
import { baseColumns, referencedColumns } from "../lib/formula";
import { lit } from "../lib/macro";
import { recalcNodes, wouldCreateCycle } from "../lib/recalc";
import type { ComputedColumn, Dataset } from "../lib/types";
import { formulaLetter, withRecomputedFormulas } from "./computedColumns";
import { withResolved } from "./pendingEdit";
import { useApp } from "./useApp";
import { syncDatasetWindowDocuments } from "./windowDocuments";

// Re-exported for existing callers/tests importing it from here — the
// function itself moved to fitRefsRun.ts (finding 8's module split, see its
// own doc) so a bare fit refresh no longer drags in lib/derivedColumn.ts.
export { refreshFitRefsFor } from "./fitRefsRun";

/** The last formula refused for a unit contradiction (dataset id + expr). */
let lastUnitRefusal: string | null = null;

export type DerivedColumnResult = { ok: true; message: string } | { ok: false; error: string };

type Step = { name: string; expr: string; propagate: boolean; allowUnitMismatch?: boolean };
type Analysed = { ok: true; columns: ComputedColumn[]; step: Step; message: string } | { ok: false; error: string };

/** Analyse `req` against `ds`: the columns to append, the step to record and the
 *  success message — or the refusal, with why. Writes nothing to the store. */
function analyse(ds: Dataset, req: DeriveRequest): Analysed {
  let r: ReturnType<typeof deriveColumns>;
  const key = `${ds.id}\n${req.expr.trim()}`;
  const interactive = req.allowUnitMismatch === undefined;
  try {
    r = deriveColumns(ds, req);
    // Interactively (no explicit allowUnitMismatch), a unit contradiction
    // refuses once; the SAME formula submitted again on the same dataset right
    // after is the user saying "add it anyway". A recipe step says it itself.
    if (!r.ok && r.unitMismatch && interactive && lastUnitRefusal === key) r = deriveColumns(ds, { ...req, allowUnitMismatch: true });
  } catch (e) {
    // The analysis only runs on text the evaluator accepted; a throw here is
    // a bug, reported as a refusal rather than an unhandled rejection.
    return { ok: false, error: `could not analyse the formula: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!r.ok) {
    lastUnitRefusal = r.unitMismatch && interactive ? key : null;
    return r.unitMismatch && interactive ? { ok: false, error: `${r.error} (or press Add again to add it without a unit)` } : r;
  }
  lastUnitRefusal = null;
  const [value, sigma] = r.columns;
  const unit = r.unit ? ` [${r.unit}]` : r.dimensionless ? " [dimensionless]" : "";
  const withSigma = sigma ? ` with "${sigma.name}" bound as its error` : "";
  const notes = r.notes.length ? ` — ${r.notes.join("; ")}` : "";
  return {
    ok: true,
    columns: r.columns,
    step: { name: value.name, expr: value.expr, propagate: req.propagate, allowUnitMismatch: r.unitMismatchAllowed },
    message: `added column "${value.name}"${unit}${withSigma}${notes}`,
  };
}

/** Resolve the dataset's full data, analyse `req` against it, and append the
 *  columns as ONE undoable, recorded step.
 *
 *  BUG-009: through `withResolved`, so analysis and commit both run on the full
 *  book, in the turn it lands. Before, a failed load REJECTED this promise with
 *  the raw fetch error — `useWorksheetView`'s `void commitColumn(...).then(...)`
 *  has no catch, so the add died as an unhandled rejection with no message of
 *  its own — and the commit carried the last refuse-only guard, which promised
 *  "try again in a moment" to a book that would never arrive. Now a failed load
 *  is an ordinary `{ ok: false }` carrying the honest message, with nothing
 *  added, recorded, or pushed to undo.
 *
 *  The commit lives INSIDE the `withResolved` callback rather than in a
 *  separately callable function, so "only ever on the full book" holds by
 *  construction — the pending-edit ratchet in architecture.test.ts checks
 *  exactly this. (The first version kept a separate commit with its own
 *  deferring guard; review found that guard unreachable, and a direct caller
 *  hitting it would have been told "failed" while the column landed later.) */
export async function addDerivedColumn(
  id: string,
  req: DeriveRequest,
): Promise<DerivedColumnResult> {
  const get = useApp.getState;
  const out = await withResolved(get, id, "adding a column", (ds): DerivedColumnResult => {
    const a = analyse(ds, req);
    if (!a.ok) return a;
    const { columns, step } = a;
    const count = ds.formulas?.length ?? 0;
    const added = columns.map((c) => ({ ...c, deps: referencedColumns(c.expr).letters }));
    for (const [i, c] of added.entries()) {
      const to = recalcNodes.column(id, formulaLetter(ds.data.labels.length, count, count + i));
      for (const dep of c.deps) {
        const reason = wouldCreateCycle(get().datasets, { from: recalcNodes.column(id, dep), to });
        if (reason) {
          get().setStatus(`Can't add column "${c.name}": ${reason}`);
          return { ok: false, error: `could not add column "${step.name}" (see the status bar)` };
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
        params: {
          name: step.name,
          expr: step.expr,
          derived: true,
          ...(step.propagate ? { propagate: true, sigmaName: added[1]?.name } : {}),
          ...(step.allowUnitMismatch ? { allowUnitMismatch: true } : {}),
        },
      },
    );
    get().touchDataset(id); // recalc graph (#1): data changed
    return { ok: true, message: a.message };
  });
  return out.ok ? out.value : { ok: false, error: out.error };
}
