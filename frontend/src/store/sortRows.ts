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
import { isRederived, rederivedNotice } from "../lib/rederived";
import { sidecarRowCount, sliceRowSidecars } from "../lib/rowSidecars";
import { excludedSet } from "../lib/rowstate";
import type { Dataset } from "../lib/types";
import { clearOverlaysFor } from "./corrections";
import { resolvePendingEdit } from "./pendingEdit";
import { toast } from "./toasts";
import { recompute, useApp } from "./useApp";

/** A sort key: a channel index (-1 = X) or a text column by name. */
export type SortKey = number | string;

/** One key of a (multi-key) worksheet sort. */
export interface SortSpec {
  col: SortKey;
  dir: 1 | -1;
}

/** A comparator for ONE key: blanks last in both directions, 0 on a tie. */
function keyComparator(ds: Dataset, { col, dir }: SortSpec): (a: number, b: number) => number {
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
  return (a, b) => {
    const ba = blank(a);
    const bb = blank(b);
    if (ba || bb) return ba === bb ? 0 : ba ? 1 : -1;
    return dir * (text ? text[a]!.localeCompare(text[b]!, undefined, { numeric: true }) : raw[a] - raw[b]);
  };
}

/** The row order that sorts `ds` by `keys` in turn (Origin's Sort Worksheet
 *  › Custom): a later key only orders rows the earlier ones tie; stable. */
export function sortOrderBy(ds: Dataset, keys: readonly SortSpec[]): number[] {
  const cmps = keys.map((k) => keyComparator(ds, k));
  const order = Array.from({ length: ds.data.time.length }, (_, r) => r);
  return order.sort((a, b) => {
    for (const cmp of cmps) {
      const c = cmp(a, b);
      if (c !== 0) return c;
    }
    return a - b;
  });
}

/** The row order that sorts `ds` by `col`: stable, blanks last. */
export function sortOrder(ds: Dataset, col: SortKey, dir: 1 | -1): number[] {
  return sortOrderBy(ds, [{ col, dir }]);
}

/** Formulas that read by POSITION: re-evaluated in the new row order. */
const POSITIONAL = /\b(?:cumsum|diff|lag|row)\s*\(|\[/;

const get = useApp.getState;

/** A refusal is a toast as well as the status line (re-audit #8): read only
 *  in the status bar, it looked like nothing happened, and Ctrl+Z then undid
 *  the user's previous edit instead. */
export function refuseRowOrder(msg: string): void {
  get().setStatus(msg);
  toast(msg, "danger");
}

/** Why `ds`'s rows can't be reordered (`verb`: "sort", "move rows in"), or
 *  null. sheet("Name", L) pairs row i here with row i THERE, so moving either
 *  side's rows would silently pair them with other rows. */
export function rowOrderRefusal(ds: Dataset, verb: string): string | null {
  const reads = (ds.formulas ?? []).filter((f) => f.sheets?.length).map((f) => `"${f.name}"`);
  if (reads.length) {
    return `Can't ${verb} "${ds.name}": ${reads.join(", ")} ${reads.length === 1 ? "reads" : "read"} another worksheet row by row through sheet(), and ${verb === "sort" ? "sorting" : "moving rows"} would pair its rows with different rows there — remove that column first`;
  }
  const readBy = get()
    .datasets.filter((d) => d.id !== ds.id && d.formulas?.some((f) => f.sheets?.some((b) => b.id === ds.id)))
    .map((d) => `"${d.name}"`);
  if (readBy.length) {
    return `Can't ${verb} "${ds.name}": ${readBy.join(", ")} ${readBy.length === 1 ? "reads" : "read"} it row by row through sheet(), and ${verb === "sort" ? "sorting" : "moving rows"} would pair those rows with different rows here — remove those columns first`;
  }
  return null;
}

/** Commit row order `order` (new row i = old row order[i]) as ONE undo step:
 *  numbers, sidecars and exclusion marks move together, formulas recompute.
 *  Returns the status-line note on formulas that read by position (they were
 *  re-evaluated in the new order), "" when there are none. */
export function commitRowOrder(id: string, ds: Dataset, order: readonly number[], label: string, macro: [string, string]): string | null {
  // Both callers resolve a pending book first; this is the backstop, since an
  // order computed on preview rows means nothing for the full ones (null =
  // nothing committed; the guard has loaded the data and said so).
  if (resolvePendingEdit(get, ds, label, () => false)) return null;
  // Text-only rows past the numeric end keep their place.
  const span = sidecarRowCount(ds.data.metadata, ds.data.time.length);
  const rowIndexes = [...order, ...Array.from({ length: span - order.length }, (_, i) => order.length + i)];
  const newIndex = new Map(rowIndexes.map((old, i) => [old, i]));
  get().recordHistory(label);
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
  get().recordMacro(...macro);
  get().touchDataset(id);
  const running = (ds.formulas ?? []).filter((f) => POSITIONAL.test(f.expr)).map((f) => `"${f.name}"`);
  return running.length
    ? `; ${running.join(", ")} ${running.length === 1 ? "reads" : "read"} rows by position and ${running.length === 1 ? "was" : "were"} recalculated in the new order`
    : "";
}

/** A key's name for the status line. */
function keyName(ds: Dataset, col: SortKey): string {
  if (typeof col === "string") return col;
  return col < 0 ? String(ds.data.metadata?.x_column_name ?? "") || "X" : ds.data.labels[col] ?? `column ${col + 1}`;
}

const how = (dir: 1 | -1): string => (dir === 1 ? "ascending" : "descending");

/** Sort dataset `id`'s rows by `keys` in turn (Origin's Sort Worksheet). */
export function sortWorksheetRowsBy(id: string, keys: readonly SortSpec[]): void {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds || keys.length === 0) return;
  if (isRederived(ds)) return refuseRowOrder(rederivedNotice(ds));
  if (resolvePendingEdit(get, ds, "sorting", () => sortWorksheetRowsBy(id, keys))) return;
  const why = rowOrderRefusal(ds, "sort");
  if (why) return refuseRowOrder(why);
  const by = keys.map((k) => `"${keyName(ds, k.col)}" (${how(k.dir)})`).join(", then ");
  const order = sortOrderBy(ds, keys);
  if (order.every((r, i) => r === i)) return get().setStatus(`already sorted by ${by} — nothing changed`);
  const [k0] = keys;
  const macro: [string, string] =
    keys.length === 1
      ? [`Sort ${ds.name} by ${keyName(ds, k0.col)} (${how(k0.dir)})`, `qz.sortRows(${lit(ds.name)}, ${lit(keyName(ds, k0.col))}, ${lit(how(k0.dir))})`]
      : [`Sort ${ds.name} by ${by}`, `qz.sortRowsBy(${lit(ds.name)}, ${lit(keys.map((k) => `${keyName(ds, k.col)} ${how(k.dir)}`).join("; "))})`];
  const rerun = commitRowOrder(id, ds, order, "sort rows", macro);
  if (rerun === null) return;
  get().setStatus(`sorted ${order.length} rows by ${by}${rerun} — Undo restores the order`);
}

/** Sort dataset `id`'s rows by column `col` (-1 = X). */
export function sortWorksheetRows(id: string, col: SortKey, dir: 1 | -1): void {
  sortWorksheetRowsBy(id, [{ col, dir }]);
}

