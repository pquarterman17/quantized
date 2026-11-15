// Building a worksheet from scratch (gap audit 4, G12): Origin's Fill Column
// With (row numbers, a linear sequence, uniform / normal random numbers —
// lib/fillSeries.ts) and Set Row Count. Each is ONE undo step with a status
// line. A fill writes values into data columns (and X); a computed column is
// its formula's, and a categorical column holds level codes, so both are
// refused and say so. Loaded with the worksheet pane (a lazy chunk).

import { isCategoricalChannel } from "../lib/categorical";
import type { CellEdit } from "../lib/clipboardGrid";
import { describeFill, fillProblem, fillValues, type FillSpec } from "../lib/fillSeries";
import { editRefusalNotice, isRederived } from "../lib/rederived";
import { sidecarRowCount } from "../lib/rowSidecars";
import { resolvePendingEdit } from "./pendingEdit";
import { useApp } from "./useApp";

const get = useApp.getState;

/** The most rows Set Row Count will make (a typo guard, not a data limit). */
export const MAX_ROW_COUNT = 10_000_000;

/** Fill columns `cols` (-1 = X) of dataset `id`, every row, with `spec`. */
export function fillColumns(id: string, cols: readonly number[], spec: FillSpec): void {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return;
  if (isRederived(ds)) {
    get().setStatus(editRefusalNotice(ds));
    return;
  }
  if (resolvePendingEdit(get, ds, "filling a column", () => fillColumns(id, [...cols], spec))) return;
  const why = fillProblem(spec);
  if (why) {
    get().setStatus(`can't fill: ${why}`);
    return;
  }
  const base = ds.data.labels.length - (ds.formulas?.length ?? 0);
  const targets = [...new Set(cols)].filter((c) => c >= -1 && c < base && !(c >= 0 && isCategoricalChannel(ds.data, c)));
  const skipped = cols.length - targets.length;
  const rows = ds.data.time.length;
  if (targets.length === 0 || rows === 0) {
    get().setStatus(rows === 0 ? "the worksheet has no rows — Set row count first" : "only data columns can be filled; a computed column is its formula's, a categorical one holds level codes");
    return;
  }
  const values = fillValues(spec, rows);
  const edits: CellEdit[] = [];
  for (const col of targets) for (let r = 0; r < rows; r++) edits.push({ row: r, col, value: values[r] });
  get().setCellBlock(id, edits, "fill column");
  const what = targets.length === 1 ? `"${targets[0] < 0 ? "X" : ds.data.labels[targets[0]]}"` : `${targets.length} columns`;
  get().setStatus(`filled ${what} with ${describeFill(spec)}${skipped ? ` (skipped ${skipped} computed or categorical)` : ""} — Undo restores ${targets.length === 1 ? "it" : "them"}`);
}

/** Origin's Set Row Count: grow with blank rows at the end, or cut the rows
 *  past `count` (every column, text cells included). One undo step.
 *  `expected` is the row count the user was shown: if the sheet has a
 *  different count by the time this runs (a loading book resolved to its full
 *  rows), it is refused — "300" meant "add 100" against 200 rows, and must
 *  never become "cut 700" against the full 1000. */
export function setRowCount(id: string, count: number, expected?: number): void {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return;
  if (!Number.isInteger(count) || count < 0 || count > MAX_ROW_COUNT) {
    get().setStatus(`the row count must be a whole number from 0 to ${MAX_ROW_COUNT.toLocaleString()}`);
    return;
  }
  if (isRederived(ds)) {
    get().setStatus(editRefusalNotice(ds));
    return;
  }
  if (resolvePendingEdit(get, ds, "setting the row count", () => setRowCount(id, count, expected ?? sidecarRowCount(ds.data.metadata, ds.data.time.length)))) return;
  const now = sidecarRowCount(ds.data.metadata, ds.data.time.length);
  if (expected !== undefined && expected !== now) {
    get().setStatus(`nothing changed: the worksheet has ${now} rows, not the ${expected} shown when you chose ${count} — set the row count again`);
    return;
  }
  if (count === now) {
    get().setStatus(`the worksheet already has ${now} rows`);
    return;
  }
  if (count > now) get().insertRows(id, now, count - now);
  else get().deleteRows(id, Array.from({ length: now - count }, (_, i) => count + i));
  get().setStatus(`${count > now ? "added" : "removed"} ${Math.abs(count - now)} row${Math.abs(count - now) === 1 ? "" : "s"} — the worksheet has ${count} rows; Undo restores the old count`);
}
