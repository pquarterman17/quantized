// Set Column Values, complex result (plans/COMPLEX_FORMULA_CONTRACT.md C7): a
// formula whose value is complex cannot be one column (a cell holds one real
// number), so the dialog offers to write its two parts as TWO ordinary computed
// columns, `<name> (re)` = re(<expr>) and `<name> (im)` = im(<expr>). No pair
// metadata is kept; a later contract may link them for an Argand plot. Lazy,
// with the dialog (components/Stage/worksheet/SetColumnValuesDialog.tsx).
//
// Fail closed: both parts are evaluated first, so an expression that does not
// compile (or errors for another reason) adds nothing; a name already taken is
// refused rather than doubled. Both columns are ONE undo step.

import { COMPLEX_DEFAULT_NAME, COMPLEX_PARTS } from "../lib/formulaComplexNames";
import { evaluateFormula, targetKind, targetNote, wrapRange, writable, type RowRange } from "../lib/setColumnValues";
import { addDerivedColumn } from "./derivedColumnRun";
import type { SetColumnValuesResult } from "./setColumnValuesRun";
import { useApp } from "./useApp";

export interface ComplexPartsRequest {
  /** The name typed in the dialog (blank: "Z", never the whole formula). */
  name: string;
  /** The formula as typed, without its row range. */
  expr: string;
  range: RowRange;
}

export async function applyComplexParts(id: string, req: ComplexPartsRequest): Promise<SetColumnValuesResult> {
  const get = useApp.getState;
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return { ok: false, error: "that worksheet is no longer open" };
  const kind = targetKind(ds, { kind: "new" });
  if (!writable(kind)) return { ok: false, error: targetNote(kind, ds) };
  const expr = req.expr.trim();
  const base = req.name.trim() || COMPLEX_DEFAULT_NAME;
  const parts = COMPLEX_PARTS.map((p) => ({ name: `${base} (${p})`, expr: `${p}(${expr})` }));
  const taken = parts.find((p) => ds.data.labels.includes(p.name));
  if (taken) return { ok: false, error: `a column named "${taken.name}" already exists; give the formula another name` };
  for (const p of parts) {
    const ev = evaluateFormula(ds, get().datasets, p.expr);
    if (ev.error !== undefined) return { ok: false, error: ev.error };
  }
  const rows = ds.data.time.length;
  const results = await get().withHistoryBatch("complex parts", async (token) => {
    const done: SetColumnValuesResult[] = [];
    for (const p of parts) {
      const r = await addDerivedColumn(id, { name: p.name, expr: wrapRange(p.expr, req.range, rows), propagate: false }, token);
      done.push(r);
      if (!r.ok) break;
    }
    return done;
  });
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok) return { ok: false, error: failed.error };
  const message = `added "${parts[0].name}" and "${parts[1].name}": the real and imaginary parts of the formula`;
  get().setStatus(message);
  return { ok: true, message };
}
