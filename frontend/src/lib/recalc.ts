// Recalc dependency graph (#1) — the workspace-wide "what depends on what"
// core. The graph is DERIVED from live state on every query (never persisted,
// so it can't go stale): edges today are
//
//   ds:<A> → ds:<B>   B's corrections consume A as the background (B.bgRef)
//   ds:<A> → fit:<A>  A's saved fit spec consumes A's data (Dataset.fitSpec)
//
// Computed columns already recompute inline (store `recompute`) and reports
// are immutable artifacts by design, so neither needs a node. Figure documents
// (#12) will add a `fig:` node kind consuming `ds:` nodes. Pure (no React /
// store / fetch) — the store owns the dirty-set and the scheduler.

import type { Dataset } from "./types";

export type RecalcMode = "auto" | "manual" | "off";

/** Everything downstream of a change to `sourceId`'s data: the datasets whose
 *  corrections re-derive from it (bgRef chains, breadth-first — a background
 *  of a background propagates), and the fit of every affected dataset
 *  (including the source's own). Cycle-safe (a seen-set guards bgRef loops). */
export function downstreamOf(
  datasets: readonly Dataset[],
  sourceId: string,
): { datasets: string[]; fits: string[] } {
  const affected: string[] = [];
  const seen = new Set<string>([sourceId]);
  const queue = [sourceId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const d of datasets) {
      if (seen.has(d.id)) continue;
      if (d.bgRef?.datasetId === id && d.corrections && d.raw) {
        seen.add(d.id);
        affected.push(d.id);
        queue.push(d.id);
      }
    }
  }
  const fits = [sourceId, ...affected].filter(
    (id) => datasets.find((d) => d.id === id)?.fitSpec,
  );
  return { datasets: affected, fits };
}

/** Merge new dirty ids into the existing arrays (store-friendly: returns the
 *  SAME references when nothing changed, so React re-renders stay minimal). */
export function markStale(
  current: readonly string[],
  add: readonly string[],
): string[] {
  const missing = add.filter((id) => !current.includes(id));
  return missing.length ? [...current, ...missing] : (current as string[]);
}
