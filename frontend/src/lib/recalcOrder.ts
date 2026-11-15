// Recalculate's upstream-first order over the stale datasets.
// Bundle diet (origin gap audit 3 #15's funding): moved verbatim out of
// lib/recalc.ts, whose other exports run at startup; only lazy modules
// call this half, so it no longer ships in the startup chunk. Imported by
// path; lib/recalc.ts does not re-export it.

import type { Dataset } from "./types";

/** LIBRARY_WORKBOOK_UX_PLAN's "recalculation ... order independence" —
 *  `staleDatasets` is NOT itself a topological order: `markStale` only
 *  APPENDS ids as separate `touchDataset` gestures discover them (see its
 *  own doc), so two gestures touching different sources can leave a
 *  downstream id sitting BEFORE its own upstream in the array (e.g. edit B
 *  directly first — stales only C — then edit A — stales B too, appended
 *  AFTER the already-present C: ["c","b"]). A caller that walked that array
 *  in raw order would rebuild C from B's PRE-recompute data. This sorts a
 *  set of stale dataset ids into true dependency order (upstream before
 *  downstream) from the CURRENT ds-level graph (bgRef + derivedFrom edges —
 *  the same edges `buildEdges` derives, collapsed past their `sheet:`/`fit:`/
 *  `col:` hops since only relative ds-to-ds order matters here), via a
 *  depth-first post-order traversal reversed into ancestors-first. Ids the graph does
 *  not order relative to each other (no path between them) come out in a
 *  deterministic but ARBITRARY order — the traversal's, not the caller's.
 *  (Review round: this used to claim `Array.prototype.sort`'s stability
 *  preserved the caller's relative order for unrelated ids. It does not: the
 *  comparator sorts on a total order derived from the traversal, so stability
 *  never comes into play. Determinism is what this function owes its caller,
 *  and determinism is what it delivers; "unchanged for unrelated ids" was
 *  never true and nothing depends on it.) A `visiting`-guard breaks a cycle defensively (should
 *  be unreachable — `wouldCreateCycle` refuses one at write time) rather
 *  than recursing forever. */
export function sortForRecalc(datasets: readonly Dataset[], ids: readonly string[]): string[] {
  const edges = new Map<string, string[]>();
  const addEdge = (from: string, to: string): void => {
    const arr = edges.get(from);
    if (arr) arr.push(to);
    else edges.set(from, [to]);
  };
  for (const d of datasets) {
    if (d.bgRef && d.corrections && d.raw) addEdge(d.bgRef.datasetId, d.id);
    if (d.derivedFrom) {
      addEdge(d.derivedFrom.datasetId, d.id);
      const secondaryId = d.analysisRecipe?.kind === "spectral"
        ? d.analysisRecipe.secondarySource?.datasetId
        : undefined;
      if (secondaryId) addEdge(secondaryId, d.id);
    }
  }
  const order: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id) || visiting.has(id)) return;
    visiting.add(id);
    for (const next of edges.get(id) ?? []) visit(next);
    visiting.delete(id);
    visited.add(id);
    order.push(id); // post-order: descendants land before their ancestor
  };
  for (const d of datasets) visit(d.id);
  order.reverse(); // ancestors before descendants
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...ids].sort((a, b) => (pos.get(a) ?? -1) - (pos.get(b) ?? -1));
}
