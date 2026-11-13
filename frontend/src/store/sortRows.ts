// Worksheet column "Sort ascending / descending" — a DATA sort, as Origin's
// column Sort is (Worksheet ▸ Sort Worksheet by the column): every row moves,
// all columns together, and it is ONE undo step with a status line. The header
// menu used to sort only the view: row numbers kept their old order, no
// status was shown, and Ctrl+Z skipped past it to undo the previous action.
//
// Rules:
//   - Stable; blank (NaN) keys go LAST in both directions, as Origin does.
//   - A categorical channel sorts by its level TEXT, not its code.
//   - Every row-indexed thing moves with its row: the numbers, the text and
//     report sidecars and fit row identities (lib/rowSidecars.ts — the same
//     slicer row delete uses) and the excluded-row marks. Rows past the
//     numeric end that only carry text cells stay where they are.
//   - Computed columns are recomputed from the sorted base, so a row-local
//     formula moves with its row and a running one (cumsum, diff, A[i]) is
//     re-evaluated in the new order — Origin's recalculation does the same.
//   - A pending lazy book loads its full rows first; a re-derived sheet is
//     refused (it is rebuilt from its source), with the usual notice.
// A lazy chunk: only the menu item imports it.

import { categoricalLevels, labelForCode } from "../lib/categorical";
import { lit } from "../lib/macro";
import { isRederived, REDERIVED_EDIT_NOTICE } from "../lib/rederived";
import { sidecarRowCount, sliceRowSidecars } from "../lib/rowSidecars";
import { excludedSet } from "../lib/rowstate";
import type { Dataset } from "../lib/types";
import { clearOverlaysFor } from "./corrections";
import { resolvePendingEdit } from "./pendingEdit";
import { recompute, useApp } from "./useApp";

/** The row order that sorts `ds` by column `col` (-1 = X): stable, blanks last. */
export function sortOrder(ds: Dataset, col: number, dir: 1 | -1): number[] {
  const n = ds.data.time.length;
  const raw = col < 0 ? ds.data.time : ds.data.values.map((row) => row[col]);
  const levels = col >= 0 ? categoricalLevels(ds.data, col) : null;
  const text = levels ? raw.map((code) => labelForCode(levels, code)) : null;
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

/** Sort dataset `id`'s rows by column `col` (-1 = X). */
export function sortWorksheetRows(id: string, col: number, dir: 1 | -1): void {
  const get = useApp.getState;
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return;
  if (isRederived(ds)) return get().setStatus(REDERIVED_EDIT_NOTICE);
  if (resolvePendingEdit(get, ds, "sorting", () => sortWorksheetRows(id, col, dir))) return;
  const name = col < 0 ? String(ds.data.metadata?.x_column_name ?? "") || "X" : ds.data.labels[col] ?? `column ${col + 1}`;
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
  get().setStatus(`sorted ${order.length} rows by "${name}" (${how}) — Undo restores the order`);
}
