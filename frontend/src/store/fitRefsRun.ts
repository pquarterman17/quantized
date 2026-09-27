// P2.5 fitted-value use — re-resolving a dataset's fit()/fitval() column
// snapshots against its CURRENT saved fit. Split out of store/derivedColumnRun.ts
// (review finding 8) so store/computedColumns.refreshFitRefsLater's dynamic
// import loads ONLY lib/derivedFitRefs.ts (+ lib/recalc.ts, already eager) —
// not lib/derivedColumn.ts's much heavier tree (the AST parser, the unit
// algebra, symbolic differentiation, the fit-model table) that a mere fit
// change or column removal has no need to pull in. derivedColumnRun.ts
// re-exports this so its own (add-column) callers are unaffected.

import { refreshFitRefs } from "../lib/derivedFitRefs";
import { downstreamOf, markStale } from "../lib/recalc";
import { useApp } from "./useApp";

/** P2.5: re-resolve dataset `id`'s fitted-value columns against its current
 *  saved fit (store/computedColumns.refreshFitRefsLater schedules this). No
 *  undo entry of its own: it follows the fit change that caused it. When a
 *  value changed, what is downstream of this dataset (bgRef / derived-sheet
 *  chains and their fits) is marked stale like any data edit — but not this
 *  dataset's OWN fit, whose change caused the refresh (marking it would ask
 *  for a refit after every fit). */
export function refreshFitRefsFor(id: string): void {
  const get = useApp.getState;
  const d = get().datasets.find((x) => x.id === id);
  const next = d && refreshFitRefs(d);
  if (!next || next === d) return;
  useApp.setState((s) => ({ datasets: s.datasets.map((x) => (x === d ? next : x)) }));
  const s = get();
  if (s.recalcMode === "off") return;
  const down = downstreamOf(s.datasets, id);
  const staleDatasets = markStale(s.staleDatasets, down.datasets);
  const staleFits = markStale(s.staleFits, down.fits.filter((f) => f !== id));
  if (staleDatasets === s.staleDatasets && staleFits === s.staleFits) return;
  useApp.setState({ staleDatasets, staleFits });
  if (s.recalcMode === "auto") void get().recalcNow();
}
