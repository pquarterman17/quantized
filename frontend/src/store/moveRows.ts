// Worksheet Move Rows: the selected rows go up or down one row, or to the top
// or bottom, as ONE undo step. The same row reorder the data sort commits
// (store/sortRows.ts's `commitRowOrder`): the numbers, every row-indexed
// sidecar (lib/rowSidecars.ts's ROW_INDEXED_SIDECARS) and the exclusion marks
// move with their row, and the same sheet() refusal applies. Loaded with the
// worksheet pane (a lazy chunk).

import { lit } from "../lib/macro";
import { isRederived, rederivedNotice } from "../lib/rederived";
import { commitRowOrder, refuseRowOrder, rowOrderRefusal } from "./sortRows";
import { useApp } from "./useApp";

/** Where Move Rows sends the selected block. */
export type RowMove = "up" | "down" | "top" | "bottom";

/** The row order (new row i = old row order[i]) that moves `rows` one step
 *  or to an end, keeping the selection's own order; `null` when nothing would
 *  move (already at that end, or nothing selected). A selected row only
 *  swaps with an UNselected neighbour, so a block moves as one. */
export function moveRowsOrder(n: number, rows: readonly number[], where: RowMove): number[] | null {
  const picked = new Set(rows.filter((r) => r >= 0 && r < n));
  if (picked.size === 0) return null;
  const all = Array.from({ length: n }, (_, r) => r);
  const sel = all.filter((r) => picked.has(r));
  const rest = all.filter((r) => !picked.has(r));
  let order: number[];
  if (where === "top") order = [...sel, ...rest];
  else if (where === "bottom") order = [...rest, ...sel];
  else {
    order = all.slice();
    const step = where === "up" ? -1 : 1;
    // Nearest the destination end first, so a block shifts as a unit.
    for (const r of where === "up" ? sel : [...sel].reverse()) {
      const at = order.indexOf(r);
      const to = at + step;
      if (to < 0 || to >= n || picked.has(order[to])) continue;
      [order[at], order[to]] = [order[to], order[at]];
    }
  }
  return order.every((r, i) => r === i) ? null : order;
}

/** Insert as many blank rows as `rows` holds, above the first (the row
 *  menu's Insert; `insertRows` owns the shifting rules), with a status line. */
export function insertRowsAbove(id: string, rows: readonly number[]): void {
  const get = useApp.getState;
  if (rows.length === 0) return;
  const at = rows.reduce((m, r) => Math.min(m, r), rows[0]); // no spread: a selection can be 1M rows
  get().insertRows(id, at, rows.length);
  get().setStatus(`inserted ${rows.length} row${rows.length === 1 ? "" : "s"} above row ${at + 1}`);
}

/** Delete rows `rows` (the row menu's Delete), with a status line. */
export function deleteRowsAt(id: string, rows: readonly number[]): void {
  const get = useApp.getState;
  get().deleteRows(id, rows);
  get().setStatus(`deleted ${rows.length} row${rows.length === 1 ? "" : "s"} — Undo restores ${rows.length === 1 ? "it" : "them"}`);
}

/** Move dataset `id`'s rows `rows`. Returns their new indices (so the row
 *  selection can follow them), or null when refused or nothing moved. */
export function moveWorksheetRows(id: string, rows: readonly number[], where: RowMove): number[] | null {
  const get = useApp.getState;
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return null;
  if (isRederived(ds)) {
    refuseRowOrder(rederivedNotice(ds));
    return null;
  }
  if (ds.pending != null) {
    // The selection was made on preview rows; it can't be replayed on the
    // full grid, so load it and ask again rather than move the wrong rows.
    get().ensureBookData(id);
    get().setStatus(`Loading full data for "${ds.name}" — select the rows again to move them`);
    return null;
  }
  const why = rowOrderRefusal(ds, "move rows in");
  if (why) {
    refuseRowOrder(why);
    return null;
  }
  const order = moveRowsOrder(ds.data.time.length, rows, where);
  if (!order) {
    const end = where === "up" || where === "top" ? "top" : "bottom";
    get().setStatus(rows.length ? `the selected rows are already at the ${end}` : "select rows to move");
    return null;
  }
  const rerun = commitRowOrder(id, ds, order, "move rows", [
    `Move ${rows.length} row(s) ${where} in ${ds.name}`,
    `qz.moveRows(${lit(ds.name)}, ${rows.length}, ${lit(where)})`,
  ]);
  if (rerun === null) return null;
  const moved = new Set(rows);
  const now = order.flatMap((old, i) => (moved.has(old) ? [i] : []));
  const n = now.length;
  get().setStatus(`moved ${n} row${n === 1 ? "" : "s"} ${where}${rerun} — Undo puts ${n === 1 ? "it" : "them"} back`);
  return now;
}
