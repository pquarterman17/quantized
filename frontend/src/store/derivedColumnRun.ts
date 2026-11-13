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
import { formulaLetter, linkSheets, withRecomputedFormulas } from "./computedColumns";
import type { HistoryBatchToken } from "./history";
import { withResolved } from "./pendingEdit";
import { useApp } from "./useApp";
import { syncDatasetWindowDocuments } from "./windowDocuments";

// Re-exported for existing callers/tests importing it from here — the
// function itself moved to fitRefsRun.ts (finding 8's module split, see its
// own doc) so a bare fit refresh no longer drags in lib/derivedColumn.ts.
export { refreshFitRefsFor } from "./fitRefsRun";

/** `warning`: the column was added, but something about it needs saying
 *  where the user is looking (a unit contradiction left it with no unit). */
export type DerivedColumnResult = { ok: true; message: string; warning?: string } | { ok: false; error: string };

type Step = { name: string; expr: string; propagate: boolean; allowUnitMismatch?: boolean };
type Analysed = { ok: true; columns: ComputedColumn[]; step: Step; message: string; warning?: string } | { ok: false; error: string };

/** Analyse `req` against `ds`: the columns to append, the step to record and the
 *  success message — or the refusal, with why. Writes nothing to the store. */
function analyse(ds: Dataset, req: DeriveRequest): Analysed {
  let r: ReturnType<typeof deriveColumns>;
  const interactive = req.allowUnitMismatch === undefined;
  try {
    // Worksheet audit #17: interactively (no explicit allowUnitMismatch), a
    // unit contradiction no longer refuses the first Add and waits for a
    // second click — the column is added WITHOUT a unit and the contradiction
    // is shown inline as a warning. A recipe step still says it itself.
    r = deriveColumns(ds, interactive ? { ...req, allowUnitMismatch: true } : req);
  } catch (e) {
    // The analysis only runs on text the evaluator accepted; a throw here is
    // a bug, reported as a refusal rather than an unhandled rejection.
    return { ok: false, error: `could not analyse the formula: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!r.ok) return r;
  const [value, sigma] = r.columns;
  const unit = r.unit ? ` [${r.unit}]` : r.dimensionless ? " [dimensionless]" : "";
  const withSigma = sigma ? ` with "${sigma.name}" bound as its error` : "";
  const notes = r.notes.length ? ` — ${r.notes.join("; ")}` : "";
  return {
    ok: true,
    columns: r.columns,
    step: { name: value.name, expr: value.expr, propagate: req.propagate, allowUnitMismatch: r.unitMismatchAllowed },
    message: `added column "${value.name}"${unit}${withSigma}${notes}`,
    ...(r.unitMismatchAllowed ? { warning: `added "${value.name}" without a unit: ${r.notes.find((n) => n.includes("WITHOUT a unit")) ?? "its operands' units contradict each other"}` } : {}),
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
  /** Fold this add into an enclosing `withHistoryBatch` (one undo step for
   *  several columns, e.g. the Curve Fit's fitted + residual pair). */
  batchToken?: HistoryBatchToken,
): Promise<DerivedColumnResult> {
  const get = useApp.getState;
  const out = await withResolved(get, id, "adding a column", (ds): DerivedColumnResult => {
    const a = analyse(ds, req);
    if (!a.ok) return a;
    const { columns, step } = a;
    const count = ds.formulas?.length ?? 0;
    const added: ComputedColumn[] = [];
    for (const c of columns) {
      // sheet("Name", …) is linked to its worksheet by id here, or refused.
      const linked = linkSheets(get, id, c.expr);
      if ("error" in linked) return { ok: false, error: linked.error };
      added.push({ ...c, deps: referencedColumns(c.expr).letters, ...(linked.sheets ? { sheets: linked.sheets } : {}) });
    }
    for (const [i, c] of added.entries()) {
      const to = recalcNodes.column(id, formulaLetter(ds.data.labels.length, count, count + i));
      for (const dep of c.deps ?? []) {
        const reason = wouldCreateCycle(get().datasets, { from: recalcNodes.column(id, dep), to });
        if (reason) return { ok: false, error: reason };
      }
    }
    const bind = added.length > 1;
    get().recordHistory("add column", batchToken);
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
    // A column that was added but errors on evaluation (a range outside the
    // rows, a cut sheet() link…) must say so where the user is looking — the
    // header badge alone is easy to miss next to a status reading "added".
    const errors = get().datasets.find((d) => d.id === id)?.formulaErrors;
    const failed = added.find((c) => errors?.[c.name]);
    const warning = failed ? `"${failed.name}" was added, but it has an error: ${errors![failed.name]}` : a.warning;
    return { ok: true, message: failed ? `${a.message} — but it has an error: ${errors![failed.name]}` : a.message, ...(warning ? { warning } : {}) };
  });
  const r: DerivedColumnResult = out.ok ? out.value : { ok: false, error: out.error };
  // Every refusal replaces the status, so it never goes on reading the
  // previous column's "added …" while the formula row shows this error
  // (live check). The inline message carries the same reason.
  const named = req.name.trim() ? ` "${req.name.trim()}"` : "";
  if (!r.ok) get().setStatus(`Can't add column${named}: ${r.error}`);
  return r;
}
