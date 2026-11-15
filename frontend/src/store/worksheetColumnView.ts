// Worksheet column visibility commands (Origin's Hide Columns / Show Columns
// and freeze panes), each ONE undo step with a status line. View-only: the
// data, the plot bindings and the formulas never change, so there is no
// `touchDataset` here — only `Dataset.hiddenCols` / `frozenCols` move
// (lib/worksheetColumnView.ts). Loaded with the worksheet pane (a lazy chunk).

import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

const get = useApp.getState;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function patch(id: string, label: string, status: string, fields: Pick<Dataset, "hiddenCols" | "frozenCols">): void {
  get().recordHistory(label);
  useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === id ? { ...d, ...fields } : d)) }));
  get().setStatus(status);
}

/** Hide value columns `cols` (in-range, not already hidden). */
export function hideColumns(id: string, cols: readonly number[]): void {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return;
  const have = new Set(ds.hiddenCols ?? []);
  const add = [...new Set(cols)].filter((c) => Number.isInteger(c) && c >= 0 && c < ds.data.labels.length && !have.has(c));
  if (add.length === 0) return;
  const hiddenCols = [...have, ...add].sort((a, b) => a - b);
  patch(id, "hide columns", `hid ${plural(add.length, "column")} — view only, still plottable (${hiddenCols.length} hidden)`, {
    hiddenCols,
    frozenCols: ds.frozenCols,
  });
}

/** Show `cols` again, or every hidden column when `cols` is omitted. */
export function showColumns(id: string, cols?: readonly number[]): void {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds?.hiddenCols?.length) return;
  const drop = new Set(cols ?? ds.hiddenCols);
  const hiddenCols = ds.hiddenCols.filter((c) => !drop.has(c));
  const shown = ds.hiddenCols.length - hiddenCols.length;
  if (shown === 0) return;
  patch(id, "show columns", `showed ${plural(shown, "column")}${hiddenCols.length ? ` (${hiddenCols.length} still hidden)` : ""}`, {
    hiddenCols: hiddenCols.length ? hiddenCols : undefined,
    frozenCols: ds.frozenCols,
  });
}

/** Freeze the first `count` columns (0 unfreezes): they stay in view while the
 *  rest scroll sideways. The X column is always pinned. */
export function setFrozenColumns(id: string, count: number): void {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return;
  const n = Math.max(0, Math.min(Math.floor(count), ds.data.labels.length));
  if (n === (ds.frozenCols ?? 0)) return;
  patch(id, n ? "freeze columns" : "unfreeze columns", n ? `froze the first ${plural(n, "column")}` : "unfroze columns", {
    hiddenCols: ds.hiddenCols,
    frozenCols: n || undefined,
  });
}
