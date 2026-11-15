// Set Column Values (gap audit 4, G3) — the apply behind the lazy dialog
// (components/Stage/worksheet/SetColumnValuesDialog.tsx). Three destinations,
// each ONE undo step; what each one keeps is set out in
// lib/setColumnValues.ts's header:
//   - a new column: the derived-column path every new formula column takes
//     (unit, fitted values, optional propagated σ — store/derivedColumnRun.ts);
//   - an existing computed column: its formula replaced (`updateFormula`'s
//     checks: cycles, sheet links, recalculation). A range-only change keeps
//     the unit and the σ binding (and re-ranges the σ column);
//   - an existing data column or X: the values the preview showed, written
//     into the rows of the range with one `setCellBlock`.
// A book still loading its full data is refused (its row count and rows are
// the preview's), and so is a data column of a re-derived sheet. Lazy: loaded
// with the dialog.

import type { CellEdit } from "../lib/clipboardGrid";
import { deriveColumns } from "../lib/derivedColumn";
import {
  baseCountOf,
  evaluateFormula,
  sameFormula,
  targetKind,
  targetNote,
  unwrapRange,
  wrapRange,
  writable,
  type RowRange,
  type ScvTarget,
} from "../lib/setColumnValues";
import type { ComputedColumn, Dataset } from "../lib/types";
import { addDerivedColumn } from "./derivedColumnRun";
import { useApp } from "./useApp";
import { historyMark, mergeHistorySince } from "./worksheetGrow";

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

/** Set Column Values on computed column `col`. Changing only the row range
 *  keeps the column's unit and σ link, and re-ranges its σ partner too; a new
 *  formula gets its unit re-derived (the σ link describes the old formula and
 *  is dropped — the dialog says so first). One undo step. */
function applyToComputed(ds: Dataset, col: number, req: SetColumnValuesRequest, expr: string): SetColumnValuesResult {
  const index = col - baseCountOf(ds);
  const current = ds.formulas?.[index];
  if (!current) return { ok: false, error: "that column no longer has a formula" };
  const rows = ds.data.time.length;
  const rangeOnly = sameFormula(unwrapRange(current.expr).expr, req.expr);
  const mark = historyMark();
  if (rangeOnly) {
    const keep = (f: ComputedColumn) => ({ unit: f.unit ?? "", derived: f.derived ?? null });
    if (!get().updateFormula(ds.id, index, { name: req.name, expr, ...keep(current) })) return { ok: false, error: get().status || "the formula was not changed" };
    const sigma = current.derived?.sigma;
    const sIndex = sigma ? (ds.formulas ?? []).findIndex((f) => f.name === sigma) : -1;
    if (sIndex >= 0) get().updateFormula(ds.id, sIndex, { expr: wrapRange(ds.formulas![sIndex].expr, req.range, rows), ...keep(ds.formulas![sIndex]) });
    mergeHistorySince(mark, "set column values");
    const message = `set the rows of "${req.name.trim() || current.name}"${sIndex >= 0 ? ` and its σ "${sigma}"` : ""} — unit and error binding kept`;
    get().setStatus(message);
    return { ok: true, message };
  }
  const derived = deriveColumns(ds, { name: req.name, expr, propagate: false });
  const autoUnit = derived.ok ? derived.unit : undefined;
  // Fitted-value snapshots still apply; the unit is the new formula's, automatic.
  const fits = current.derived?.fits;
  const spec = { ...(fits ? { fits } : {}), ...(autoUnit ? { unitAuto: true } : {}) };
  const patch = autoUnit === undefined ? {} : { unit: autoUnit, derived: Object.keys(spec).length ? spec : null };
  if (!get().updateFormula(ds.id, index, { name: req.name, expr, ...patch })) return { ok: false, error: get().status || "the formula was not changed" };
  const message = `updated the formula of "${req.name.trim() || current.name}"${autoUnit ? ` [${autoUnit}]` : ""}`;
  get().setStatus(message);
  return { ok: true, message };
}

export async function applySetColumnValues(id: string, req: SetColumnValuesRequest): Promise<SetColumnValuesResult> {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return { ok: false, error: "that worksheet is no longer open" };
  const kind = targetKind(ds, req.target);
  // Never from the preview of a loading book, never into a rebuilt sheet.
  if (!writable(kind)) return { ok: false, error: targetNote(kind, ds) };
  const expr = wrapRange(req.expr.trim(), req.range, ds.data.time.length);
  if (req.target.kind === "new") {
    const r = await addDerivedColumn(id, { name: req.name, expr, propagate: req.propagate === true });
    if (!r.ok) return { ok: false, error: r.error };
    get().setStatus(r.warning ? `${r.message} — ${r.warning}` : r.message); // the dialog closes: say it where it stays
    return r;
  }
  const col = req.target.col;
  if (kind === "computed") return applyToComputed(ds, col, req, expr);
  // A data column (or X): values, written once.
  const ev = evaluateFormula(ds, get().datasets, req.expr);
  if (ev.error !== undefined) return { ok: false, error: ev.error };
  const edits: CellEdit[] = [];
  for (let r = req.range.from; r <= Math.min(req.range.to, ds.data.time.length); r++) edits.push({ row: r - 1, col, value: ev.values[r - 1] });
  if (edits.length === 0) return { ok: false, error: "no rows in that range" };
  const mark = historyMark();
  get().setCellBlock(id, edits, "set column values");
  // setCellBlock refuses some sheets by status only: success is an undo entry.
  if (historyMark() === mark) return { ok: false, error: get().status || "nothing was written" };
  const name = col < 0 ? "X" : ds.data.labels[col];
  const span = req.range.from === 1 && req.range.to >= ds.data.time.length ? "every row" : `rows ${req.range.from}–${req.range.to}`;
  const message = `wrote ${edits.length} value${edits.length === 1 ? "" : "s"} into "${name}" (${span}) — values only; Undo restores the old ones`;
  get().setStatus(message);
  return { ok: true, message };
}
