// Set Column Values (gap audit 4, G3) — the apply behind the lazy dialog
// (components/Stage/worksheet/SetColumnValuesDialog.tsx). Three destinations,
// each ONE undo step; what each one keeps is set out in
// lib/setColumnValues.ts's header:
//   - a new column: the derived-column path every new formula column takes
//     (unit, fitted values, optional propagated σ — store/derivedColumnRun.ts);
//   - an existing computed column: its formula replaced (`updateFormula`'s
//     checks: cycles, sheet links, recalculation);
//   - an existing data column or X: the values the preview showed, written
//     into the rows of the range with one `setCellBlock`.
// Lazy: loaded with the dialog.

import type { CellEdit } from "../lib/clipboardGrid";
import {
  evaluateFormula,
  targetKind,
  wrapRange,
  type RowRange,
  type ScvTarget,
} from "../lib/setColumnValues";
import { addDerivedColumn } from "./derivedColumnRun";
import { withResolved } from "./pendingEdit";
import { useApp } from "./useApp";
import { editColumnFormula } from "./worksheetColumns";

export interface SetColumnValuesRequest {
  target: ScvTarget;
  /** The new column's name, or a computed column's (blank keeps it). */
  name: string;
  expr: string;
  range: RowRange;
  /** New column only: also add its propagated σ, bound as its error. */
  propagate?: boolean;
}

export type SetColumnValuesResult = { ok: true; message: string; warning?: string } | { ok: false; error: string };

const get = useApp.getState;

export async function applySetColumnValues(id: string, req: SetColumnValuesRequest): Promise<SetColumnValuesResult> {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return { ok: false, error: "that worksheet is no longer open" };
  const rows = ds.data.time.length;
  const kind = targetKind(ds, req.target);
  if (kind === "categorical") return { ok: false, error: "a categorical column holds level codes; write the formula to a new column" };
  const expr = wrapRange(req.expr.trim(), req.range, rows);
  if (req.target.kind === "new") {
    const r = await addDerivedColumn(id, { name: req.name, expr, propagate: req.propagate === true });
    if (!r.ok) return { ok: false, error: r.error };
    get().setStatus(r.warning ? `${r.message} — ${r.warning}` : r.message); // the dialog closes: say it where it stays
    return r;
  }
  const col = req.target.col;
  if (kind === "computed") {
    if (!editColumnFormula(id, col, req.name, expr)) return { ok: false, error: get().status || "the formula was not changed" };
    return { ok: true, message: get().status };
  }
  // A data column (or X): values, written once.
  const out = await withResolved(get, id, "setting column values", (full): SetColumnValuesResult => {
    const ev = evaluateFormula(full, get().datasets, req.expr);
    if (ev.error !== undefined) return { ok: false, error: ev.error };
    const edits: CellEdit[] = [];
    for (let r = req.range.from; r <= Math.min(req.range.to, full.data.time.length); r++) edits.push({ row: r - 1, col, value: ev.values[r - 1] });
    if (edits.length === 0) return { ok: false, error: "no rows in that range" };
    get().setCellBlock(id, edits, "set column values");
    const name = col < 0 ? "X" : full.data.labels[col];
    const span = req.range.from === 1 && req.range.to >= full.data.time.length ? "every row" : `rows ${req.range.from}–${req.range.to}`;
    return { ok: true, message: `wrote ${edits.length} value${edits.length === 1 ? "" : "s"} into "${name}" (${span}) — values only; Undo restores the old ones` };
  });
  if (!out.ok) return { ok: false, error: out.error };
  if (out.value.ok) get().setStatus(out.value.message);
  return out.value;
}
