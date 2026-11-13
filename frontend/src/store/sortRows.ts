// Worksheet column "Sort ascending / descending" — a DATA sort, as Origin's
// column Sort is (Worksheet ▸ Sort Worksheet by the column): every row moves,
// all columns together, and it is ONE undo step with a status line. The header
// menu used to sort only the view: row numbers kept their old order, no
// status was shown, and Ctrl+Z skipped past it to undo the previous action.
//
// Rules (each locked by store/sortRows.test.ts):
//   - Stable; blank keys go LAST in both directions, as Origin does.
//   - A categorical channel sorts by its level TEXT, not its code; a text
//     column (by name) sorts by its cell text.
//   - What moves with its row: the numbers, the text and report sidecars and
//     fit row identities (lib/rowSidecars.ts — the slicer row delete uses) and
//     the excluded-row marks. Rows past the numeric end that only carry text
//     cells stay where they are.
//   - Computed columns are recomputed from the sorted base. A row-local
//     formula moves with its row; a running or indexing one (cumsum, diff,
//     lag, A[i], row()) is re-evaluated in the new order — Origin's
//     recalculation does the same — and the status says so.
//   - REFUSED, both ways, where sheet("Name", L) links rows across worksheets:
//     a sheet whose formulas read another worksheet, and a sheet another
//     worksheet reads. Such a column pairs row i here with row i THERE, so
//     moving either side's rows would silently pair them with other rows.
//   - A pending lazy book loads its full rows first; a re-derived sheet is
//     refused (it is rebuilt from its source), with the usual notice.
// A lazy chunk: only the menu items import it.

import { categoricalLevels, labelForCode } from "../lib/categorical";
import { lit } from "../lib/macro";
import { textColumnCells } from "../lib/originTextColumnCells";
import { isRederived, REDERIVED_EDIT_NOTICE } from "../lib/rederived";
import { sidecarRowCount, sliceRowSidecars } from "../lib/rowSidecars";
import { excludedSet } from "../lib/rowstate";
import type { Dataset } from "../lib/types";
import { clearOverlaysFor } from "./corrections";
import { resolvePendingEdit } from "./pendingEdit";
import { toast } from "./toasts";
import { recompute, useApp } from "./useApp";

/** A sort key: a channel index (-1 = X) or a text column by name. */
export type SortKey = number | string;

/** The row order that sorts `ds` by `col`: stable, blanks last. */
export function sortOrder(ds: Dataset, col: SortKey, dir: 1 | -1): number[] {
  const n = ds.data.time.length;
  let text: (string | null)[] | null = null;
  let raw: readonly number[] = [];
  if (typeof col === "string") {
    const cells = textColumnCells(ds.data, col) ?? [];
    text = Array.from({ length: n }, (_, r) => String(cells[r] ?? "").trim() || null);
  } else {
    raw = col < 0 ? ds.data.time : ds.data.values.map((row) => row[col]);
    const levels = col >= 0 ? categoricalLevels(ds.data, col) : null;
    if (levels) text = raw.map((code) => labelForCode(levels, code));
  }
  const blank = (r: number): boolean => (text ? text[r] === null : !Number.isFinite(raw[r]));
  const order = Array.from({ length: n }, (_, r) => r);
  return order.sort((a, b) => {
    const ba = blank(a);
    const bb = blank(b);
    if (ba || bb) return ba === bb ? a - b : ba ? 1 : -1;
    const cmp = text ? text[a]!.localeCompare(text[b]!, undefined, { numeric: true }) : raw[a] - raw[b];
    return cmp === 0 ? a - b : dir * cmp;
  });
}

/** Formulas that read by POSITION: re-evaluated in the new row order. */
const POSITIONAL = /\b(?:cumsum|diff|lag|row)\s*\(|\[/;

/** Sort dataset `id`'s rows by column `col` (-1 = X). */
export function sortWorksheetRows(id: string, col: SortKey, dir: 1 | -1): void {
  const get = useApp.getState;
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return;
  // A refusal is a toast as well as the status line (re-audit #8): read only
  // in the status bar, it looked like nothing happened, and Ctrl+Z then
  // undid the user's previous edit instead.
  const refuse = (msg: string): void => {
    get().setStatus(msg);
    toast(msg, "danger");
  };
  if (isRederived(ds)) return refuse(REDERIVED_EDIT_NOTICE);
  if (resolvePendingEdit(get, ds, "sorting", () => sortWorksheetRows(id, col, dir))) return;
  const name =
    typeof col === "string" ? col : col < 0 ? String(ds.data.metadata?.x_column_name ?? "") || "X" : ds.data.labels[col] ?? `column ${col + 1}`;
  const reads = (ds.formulas ?? []).filter((f) => f.sheets?.length).map((f) => `"${f.name}"`);
  if (reads.length) {
    return refuse(
      `Can't sort "${ds.name}": ${reads.join(", ")} ${reads.length === 1 ? "reads" : "read"} another worksheet row by row through sheet(), and sorting would pair its rows with different rows there — remove that column first`,
    );
  }
  const readBy = get()
    .datasets.filter((d) => d.id !== id && d.formulas?.some((f) => f.sheets?.some((b) => b.id === id)))
    .map((d) => `"${d.name}"`);
  if (readBy.length) {
    return refuse(
      `Can't sort "${ds.name}": ${readBy.join(", ")} ${readBy.length === 1 ? "reads" : "read"} it row by row through sheet(), and sorting would pair those rows with different rows here — remove those columns first`,
    );
  }
  const how = dir === 1 ? "ascending" : "descending";
  const order = sortOrder(ds, col, dir);
  if (order.every((r, i) => r === i)) return get().setStatus(`already sorted by "${name}" (${how}) — nothing changed`);
  // Text-only rows past the numeric end keep their place.
  const span = sidecarRowCount(ds.data.metadata, ds.data.time.length);
  const rowIndexes = [...order, ...Array.from({ length: span - order.length }, (_, i) => order.length + i)];
  const newIndex = new Map(rowIndexes.map((old, i) => [old, i]));
  get().recordHistory("sort rows");
  useApp.setState((s) => ({
    datasets: s.datasets.map((d) => {
      if (d.id !== id) return d;
      const marked = excludedSet(d); // excluded marks move with their rows
      const excluded = marked.size ? [...marked].map((r) => newIndex.get(r) ?? r).sort((a, b) => a - b) : undefined;
      return recompute({
        ...d,
        data: {
          ...d.data,
          time: order.map((r) => d.data.time[r]),
          values: order.map((r) => d.data.values[r]),
          metadata: sliceRowSidecars(d.data.metadata, rowIndexes),
        },
        ...(excluded ? { excludedRows: excluded } : {}),
      });
    }),
    ...clearOverlaysFor(s, id),
  }));
  get().recordMacro(`Sort ${ds.name} by ${name} (${how})`, `qz.sortRows(${lit(ds.name)}, ${lit(name)}, ${lit(how)})`);
  get().touchDataset(id);
  const running = (ds.formulas ?? []).filter((f) => POSITIONAL.test(f.expr)).map((f) => `"${f.name}"`);
  const rerun = running.length ? `; ${running.join(", ")} ${running.length === 1 ? "reads" : "read"} rows by position and ${running.length === 1 ? "was" : "were"} recalculated in the new order` : "";
  get().setStatus(`sorted ${order.length} rows by "${name}" (${how})${rerun} — Undo restores the order`);
}
