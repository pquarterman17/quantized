// "Color or mark by column…" and "Clear row colours/markers" (G24). Loaded with
// the dialog (a lazy chunk); NOT a slice of useApp, so the eager store pays
// nothing. Row states are a per-dataset VIEW property, like a column's display
// format: they ride the dataset (so every graph of it sees them, and .dwk, undo
// and redo carry them) but are not part of its analysis view, so no
// `touchDataset` (nothing recalculates).
//
// Pending (lazy Origin preview) books: the arrays are indexed by rows, and a
// preview's rows are not the book's, so an apply resolves the book first
// (`resolvePendingEdit`), like every other row-indexed write. A clear is never
// guarded: it destroys a preference rather than recording one (store/rowState.ts).

import { buildRowStyle, mergeRowStyle, type RowStyleRequest } from "../lib/rowStyleBuild";
import { resolvePendingEdit } from "./pendingEdit";
import { useApp } from "./useApp";

/** Apply colour and/or marker by column `req.column` to dataset `id`. Returns a
 *  refusal reason, or null when applied (or deferred behind a lazy book). */
export function applyRowStyleByColumn(id: string, req: RowStyleRequest): string | null {
  const get = useApp.getState;
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return "No such dataset.";
  if (resolvePendingEdit(get, ds, "coloring rows", () => { applyRowStyleByColumn(id, req); })) return null;
  const built = buildRowStyle(ds.data, req);
  if (!built.ok) {
    get().setStatus(`Row states not applied: ${built.reason}`);
    return built.reason;
  }
  get().recordHistory("color/mark rows by column");
  useApp.setState((s) => ({
    datasets: s.datasets.map((d) => (d.id === id ? { ...d, rowStyle: mergeRowStyle(d.rowStyle, built.style) } : d)),
  }));
  return null;
}

/** Remove every row colour and marker (and the legend) from dataset `id`. */
export function clearRowStyle(id: string): void {
  const get = useApp.getState;
  if (!get().datasets.find((d) => d.id === id)?.rowStyle) return;
  get().recordHistory("clear row colors/markers");
  useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === id ? { ...d, rowStyle: undefined } : d)) }));
}
