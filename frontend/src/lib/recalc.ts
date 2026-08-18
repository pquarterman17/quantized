// Recalc dependency graph (#1, extended by LIBRARY_WORKBOOK_UX_PLAN PR K
// K3/K4) — the workspace-wide "what depends on what" core. The graph is
// DERIVED FRESH from live state on every query, never persisted itself, so it
// can't go stale: what IS persisted (on the datasets/columns themselves) is
// only the EDGE-DEFINING DATA — `Dataset.bgRef`, `Dataset.fitSpec`,
// `Dataset.derivedFrom`, and `ComputedColumn.deps` — each already its own
// serialized field with its own reason to exist. This file's job is to fold
// that data into a graph on demand; it owns no state of its own. That's the
// PLAN's "store a dependency graph" requirement satisfied WITHOUT a second
// source of truth that could drift from the fields above: there is nothing
// to keep in sync, because nothing is cached.
//
// Node vocabulary (K3):
//   ds:<id>          a dataset's live/current data
//   col:<id>/<key>   one column of dataset <id> — <key> is a channel letter
//                     (`lib/formula.ts`'s channelLetter, e.g. "A"/"B"/…, or
//                     "x" for the time column). Only used for the intra-
//                     dataset formula graph (K4's cycle check); the async
//                     stale-marking path (K5a) stays dataset-granular because
//                     computed columns already recompute synchronously inline
//                     on any base-data change (`store/useApp.ts`'s `recompute`).
//   sheet:<id>       dataset <id> in its DERIVED-WORKSHEET role (K2/L0.50):
//                     the node a source edit marks stale, distinct from its
//                     plain `ds:<id>` role so a derived worksheet recalculates
//                     ONLY through the async scheduler (K5c), never inline.
//                     Chained `sheet:<id> -> ds:<id>` so once the sheet DOES
//                     recompute, everything already downstream of `ds:<id>`
//                     (further bgRefs, its own fit) sees the fresh result.
//   fit:<id>         dataset <id>'s saved fit spec.
//
// Edges (upstream -> downstream), each derived from one persisted field:
//   ds:<A> -> ds:<B>        B's corrections consume A as the background
//                            (B.bgRef.datasetId === A), and only once B
//                            actually has corrections+raw (the same "is this
//                            a live, re-derivable edge" predicate downstreamOf
//                            always used).
//   ds:<A> -> fit:<A>       A's saved fit spec consumes A's own data.
//   ds:<A> -> sheet:<B>     B is a derived worksheet sourced from A
//                            (B.derivedFrom.datasetId === A).
//   sheet:<B> -> ds:<B>     see above.
//   col:<A>/<x> -> col:<A>/<y>  column y's formula references column x
//                            (y.deps, or `referencedColumns(y.expr).letters`
//                            when `deps` is absent — a legacy column degrades
//                            to deriving it on demand rather than throwing).

import { referencedColumns, channelLetter } from "./formula";
import type { Dataset } from "./types";

export type RecalcMode = "auto" | "manual" | "off";

type NodeId = string;

const dsNode = (id: string): NodeId => `ds:${id}`;
const sheetNode = (id: string): NodeId => `sheet:${id}`;
const fitNode = (id: string): NodeId => `fit:${id}`;
const colNode = (datasetId: string, key: string): NodeId => `col:${datasetId}/${key}`;

/** Build the full upstream -> downstream edge map for the CURRENT state —
 *  see the module header for the node vocabulary and what each edge is
 *  derived from. Pure; called fresh by every query below (never cached). */
function buildEdges(datasets: readonly Dataset[]): Map<NodeId, NodeId[]> {
  const edges = new Map<NodeId, NodeId[]>();
  const addEdge = (from: NodeId, to: NodeId): void => {
    const arr = edges.get(from);
    if (arr) arr.push(to);
    else edges.set(from, [to]);
  };
  for (const d of datasets) {
    if (d.bgRef && d.corrections && d.raw) {
      addEdge(dsNode(d.bgRef.datasetId), dsNode(d.id));
    }
    if (d.fitSpec) {
      addEdge(dsNode(d.id), fitNode(d.id));
    }
    if (d.derivedFrom) {
      addEdge(dsNode(d.derivedFrom.datasetId), sheetNode(d.id));
      addEdge(sheetNode(d.id), dsNode(d.id));
    }
    const baseCount = Math.max(0, d.data.labels.length - (d.formulas?.length ?? 0));
    (d.formulas ?? []).forEach((f, i) => {
      const target = colNode(d.id, channelLetter(baseCount + i));
      const deps = f.deps ?? referencedColumns(f.expr).letters;
      for (const dep of deps) addEdge(colNode(d.id, dep), target);
    });
  }
  return edges;
}

/** Breadth-first reachability from `start` (K3: "breadth-first, visited-set
 *  safe"). Returns a parent map (reached node -> the node that discovered
 *  it) so a caller can reconstruct the path; `start` itself is never a key. */
function reachable(edges: Map<NodeId, NodeId[]>, start: NodeId): Map<NodeId, NodeId> {
  const parent = new Map<NodeId, NodeId>();
  const seen = new Set<NodeId>([start]);
  const queue: NodeId[] = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of edges.get(cur) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      parent.set(next, cur);
      queue.push(next);
    }
  }
  return parent;
}

function nameOf(id: string, datasets: readonly Dataset[]): string {
  return datasets.find((d) => d.id === id)?.name ?? id;
}

/** Human-readable label for a node in a cycle explanation. */
function labelFor(node: NodeId, datasets: readonly Dataset[]): string {
  const sep = node.indexOf(":");
  const kind = node.slice(0, sep);
  const rest = node.slice(sep + 1);
  if (kind === "sheet") return `${nameOf(rest, datasets)} (derived worksheet)`;
  if (kind === "fit") return `${nameOf(rest, datasets)}'s fit`;
  if (kind === "col") {
    const slash = rest.indexOf("/");
    return `${nameOf(rest.slice(0, slash), datasets)}.${rest.slice(slash + 1)}`;
  }
  return nameOf(rest, datasets); // "ds"
}

/** Everything downstream of a change to `sourceId`'s data: the datasets
 *  (including derived worksheets — sheet nodes collapse to their plain
 *  dataset id here) whose corrections/pipeline re-derive from it (bgRef and
 *  derivedFrom chains, breadth-first — a background/source of a background
 *  propagates), and the fit of every affected dataset (including the
 *  source's own). Cycle-safe (a seen-set guards bgRef/derivedFrom loops).
 *  Generalizes over the widened K3 vocabulary internally; the return SHAPE
 *  is the pre-K3 one (unchanged — every existing caller/test still gets
 *  exactly bgRef-chain behavior when no dataset in play has `derivedFrom`). */
export function downstreamOf(
  datasets: readonly Dataset[],
  sourceId: string,
): { datasets: string[]; fits: string[] } {
  const edges = buildEdges(datasets);
  const parent = reachable(edges, dsNode(sourceId));
  const datasetIds: string[] = [];
  const seenIds = new Set<string>();
  for (const node of parent.keys()) {
    const sep = node.indexOf(":");
    const kind = node.slice(0, sep);
    if (kind !== "ds" && kind !== "sheet") continue;
    const id = node.slice(sep + 1);
    if (id === sourceId || seenIds.has(id)) continue;
    seenIds.add(id);
    datasetIds.push(id);
  }
  const fits = [sourceId, ...datasetIds].filter(
    (id) => datasets.find((d) => d.id === id)?.fitSpec,
  );
  return { datasets: datasetIds, fits };
}

/** Write-time cycle rejection (K4): would adding `proposedEdge` (upstream
 *  `from` -> downstream `to`) close a cycle? `null` = safe to add. A
 *  non-null string is a clear, human-readable explanation naming the full
 *  cycle path — wire this into every action that creates an edge
 *  (addFormula/updateFormula, applyCorrections' bgRef, and, for
 *  LIBRARY_WORKBOOK_UX_PLAN PR K slice 2's use, the derivedFrom setter) and
 *  REFUSE with zero mutation when it returns non-null. Node ids use this
 *  module's `ds:`/`col:`/`sheet:`/`fit:` vocabulary — callers build them with
 *  the same helpers `buildEdges` uses (exported below). */
export function wouldCreateCycle(
  datasets: readonly Dataset[],
  proposedEdge: { from: NodeId; to: NodeId },
): string | null {
  const { from, to } = proposedEdge;
  if (from === to) {
    return `"${labelFor(from, datasets)}" cannot depend on itself.`;
  }
  const edges = buildEdges(datasets);
  const parent = reachable(edges, to);
  if (!parent.has(from)) return null;
  // Reconstruct the existing path `to -> ... -> from`, then the proposed
  // edge closes it back to `to`.
  const path: NodeId[] = [from];
  let cur = from;
  while (cur !== to) {
    const p = parent.get(cur);
    if (p === undefined) break; // unreachable in practice: parent.has(from) above guards this
    path.push(p);
    cur = p;
  }
  path.reverse(); // now [to, ..., from]
  const labels = [...path, to].map((n) => labelFor(n, datasets));
  return `This would create a circular dependency: ${labels.join(" → ")}.`;
}

/** Node-id builders shared with callers that construct a `proposedEdge` for
 *  `wouldCreateCycle` (K4) outside this module (e.g. `store/corrections.ts`,
 *  `store/useApp.ts`'s formula actions). */
export const recalcNodes = {
  dataset: dsNode,
  sheet: sheetNode,
  fit: fitNode,
  column: colNode,
};

/** Merge new dirty ids into the existing arrays (store-friendly: returns the
 *  SAME references when nothing changed, so React re-renders stay minimal). */
export function markStale(
  current: readonly string[],
  add: readonly string[],
): string[] {
  const missing = add.filter((id) => !current.includes(id));
  return missing.length ? [...current, ...missing] : (current as string[]);
}
