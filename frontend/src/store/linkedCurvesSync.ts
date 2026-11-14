// Keeps every LIVE multi-dataset graph (`Dataset.linkedCurves`,
// lib/linkedCurves.ts) in step with its sources: a store subscription,
// installed on first use (a graph created, or a .dwk carrying one loaded),
// re-assembles a graph's `data` whenever a source's rows, exclusions or
// filter change, or the curve list itself does (an added curve, an Undo).
//
// What a graph's current `data` was assembled from is remembered per DATA
// OBJECT (a WeakMap), so an Undo that restores an older data object is
// recognised as already in step, and a graph loaded from a .dwk (unknown
// data object) is re-assembled once from its live sources. The write is a
// plain set: no undo step (the change it mirrors recorded its own) and no
// macro step.

import { assembleLinkedCurves, linkedGraphMask, linkedGraphYTitle, linkedRowSources } from "../lib/linkedCurves";
import { excludedSet, mergeExcluded, rowStateIdentity } from "../lib/rowstate";
import type { Dataset, DataStruct, LinkedCurve } from "../lib/types";
import { useApp } from "./useApp";

/** A source's identity for change detection: rows, exclusions, filter, its
 *  type overrides (they decide which filter rows apply) and its name (the
 *  legend follows it). */
type SourceStamp = readonly unknown[] | null;
const stampOf = (d: Dataset | undefined): SourceStamp => (d ? [...rowStateIdentity(d), d.channelTypes, d.name] : null);

/** `cyclic`: assembled while on a graph <-> graph cycle (fail closed: empty
 *  curves) -- in step as long as the curve list is unchanged and it is still
 *  on a cycle, since its sources are themselves empty cycle members. */
const assembledFrom = new WeakMap<DataStruct, { curves: string; sources: SourceStamp[]; cyclic: boolean; mask: string }>();

/** A graph's mask as a comparable key (its excluded rows, ascending). */
const maskKey = (d: Dataset): string => JSON.stringify([...excludedSet(d)].sort((a, b) => a - b));

/** The graph with its mask set to the projection of its sources' dropped
 *  rows (lib/linkedCurves.linkedGraphMask) -- the only mask a graph keeps. */
function withMask(d: Dataset, curves: readonly LinkedCurve[], datasets: readonly Dataset[]): Dataset {
  const mask = linkedGraphMask(curves, datasets);
  if (!mask && excludedSet(d).size === 0) return d;
  return { ...d, excludedRows: mask };
}

/** A mask the USER set on a graph (masking its points from the plot, the
 *  worksheet or an action) is routed to the source points those rows draw:
 *  rows newly masked exclude their source row, rows unmasked include it. The
 *  graph's own mask is then rebuilt from its sources, so the mask follows the
 *  source point through every later insert, delete or sort there. Outer graphs
 *  route first, so a mask on a graph of graphs reaches the inner sources. */
function routeGraphMasks(order: readonly Dataset[], cyclic: Set<string>, latest: Map<string, Dataset>): boolean {
  let changed = false;
  for (const g of [...order].reverse()) {
    const d = latest.get(g.id)!;
    const rec = assembledFrom.get(d.data);
    if (!rec || cyclic.has(d.id) || rec.curves !== JSON.stringify(d.linkedCurves) || rec.mask === maskKey(d)) continue;
    const before = new Set<number>(JSON.parse(rec.mask) as number[]);
    const now = excludedSet(d);
    const points = linkedRowSources(d.linkedCurves!, [...latest.values()]);
    const edits = new Map<string, { add: number[]; drop: Set<number> }>();
    const edit = (id: string) => edits.get(id) ?? edits.set(id, { add: [], drop: new Set() }).get(id)!;
    for (const r of now) if (!before.has(r) && points[r]) edit(points[r].id).add.push(points[r].row);
    for (const r of before) if (!now.has(r) && points[r]) edit(points[r].id).drop.add(points[r].row);
    for (const [id, e] of edits) {
      const src = latest.get(id);
      if (!src) continue;
      const kept = mergeExcluded([...excludedSet(src)], e.add).filter((r) => !e.drop.has(r));
      latest.set(id, { ...src, excludedRows: kept.length ? kept : undefined });
      changed = true;
    }
  }
  return changed;
}

function sameStamp(now: SourceStamp, then: SourceStamp): boolean {
  return now === then || (now !== null && then !== null && now.length === then.length && now.every((v, k) => v === then[k]));
}

function inStep(graph: Dataset, byId: Map<string, Dataset>, cyclic: boolean): boolean {
  const rec = assembledFrom.get(graph.data);
  if (!rec || rec.curves !== JSON.stringify(graph.linkedCurves) || rec.cyclic !== cyclic || rec.mask !== maskKey(graph)) return false;
  if (cyclic) return true;
  return graph.linkedCurves!.every((c, i) => sameStamp(stampOf(byId.get(c.datasetId)), rec.sources[i]));
}

/** Graphs in build order (a graph after every graph it draws from) and the ids
 *  of those on a graph <-> graph cycle (or drawing from itself). */
function buildOrder(datasets: readonly Dataset[]): { order: Dataset[]; cyclic: Set<string> } {
  const graphs = new Map(datasets.filter((d) => d.linkedCurves).map((d) => [d.id, d]));
  const state = new Map<string, 1 | 2>(); // 1 = on the DFS path, 2 = done
  const order: Dataset[] = [];
  const cyclic = new Set<string>();
  const visit = (id: string, path: string[]): void => {
    const g = graphs.get(id)!;
    state.set(id, 1);
    path.push(id);
    for (const c of g.linkedCurves!) {
      if (!graphs.has(c.datasetId)) continue;
      const st = state.get(c.datasetId);
      if (st === 1) path.slice(path.indexOf(c.datasetId)).forEach((m) => cyclic.add(m));
      else if (st === undefined) visit(c.datasetId, path);
    }
    path.pop();
    state.set(id, 2);
    order.push(g);
  };
  for (const id of graphs.keys()) if (!state.has(id)) visit(id, []);
  return { order, cyclic };
}

/** Re-assemble every out-of-step graph in `datasets`, sources first (a graph
 *  of a graph sees its inner graph's NEW rows in the same pass); null when all
 *  are current. A graph on a cycle draws empty curves -- fail closed, it never
 *  loops and never rebinds. */
export function relinkedDatasets(datasets: readonly Dataset[]): Dataset[] | null {
  const { order, cyclic } = buildOrder(datasets);
  const latest = new Map(datasets.map((d) => [d.id, d]));
  let changed = routeGraphMasks(order, cyclic, latest);
  for (const g of order) {
    const d = latest.get(g.id)!;
    const onCycle = cyclic.has(d.id);
    if (inStep(d, latest, onCycle)) continue;
    changed = true;
    const curves = d.linkedCurves!;
    const live = onCycle ? curves.map((c) => ({ ...c, yKey: -1 })) : curves;
    const all = [...latest.values()];
    const next = withMask({ ...d, data: assembleLinkedCurves(live, all, d.data) }, live, all);
    assembledFrom.set(next.data, { curves: JSON.stringify(curves), sources: curves.map((c) => stampOf(latest.get(c.datasetId))), cyclic: onCycle, mask: maskKey(next) });
    latest.set(d.id, next);
  }
  return changed ? datasets.map((d) => latest.get(d.id)!) : null;
}

/** Mark `graph.data` as assembled from the current `datasets` (a graph the
 *  caller just built itself), so the watcher does not rebuild it again, and
 *  return it carrying its sources' mask -- the graph the caller stores. */
export function noteAssembled(graph: Dataset, datasets: readonly Dataset[]): Dataset {
  const byId = new Map(datasets.map((d) => [d.id, d]));
  const masked = withMask(graph, graph.linkedCurves ?? [], datasets);
  assembledFrom.set(masked.data, {
    curves: JSON.stringify(graph.linkedCurves),
    sources: (graph.linkedCurves ?? []).map((c) => stampOf(byId.get(c.datasetId))),
    cyclic: false,
    mask: maskKey(masked),
  });
  return masked;
}

let watching = false;
/** The datasets before the FIRST change of the pending burst (the retitle baseline). */
let pendingPrev: readonly Dataset[] | null = null;
let scheduled = false;
/** Graph rebuilds run, for the coalescing test (one per burst, not per edit). */
export let rebuildPasses = 0;

function sync(datasets: readonly Dataset[], prev?: readonly Dataset[]): void {
  if (!datasets.some((d) => d.linkedCurves)) return;
  const next = relinkedDatasets(datasets);
  if (!next) return;
  rebuildPasses++;
  // The active graph's Y title is the auto quantity title unless the user typed
  // one: keep it following the sources' quantities.
  const s = useApp.getState();
  const was = prev?.find((d) => d.id === s.activeId);
  const now = next.find((d) => d.id === s.activeId);
  const retitle =
    was?.linkedCurves && now?.linkedCurves && s.yAxisLabel === linkedGraphYTitle(was.linkedCurves, prev!)
      ? linkedGraphYTitle(now.linkedCurves, next)
      : null;
  useApp.setState({ datasets: next, ...(retitle !== null && retitle !== s.yAxisLabel ? { yAxisLabel: retitle } : {}) });
}

/** Rebuild now whatever the watcher has queued (a no-op when nothing is). The
 *  store write that caused a change returns immediately; the graph follows in
 *  a microtask, once per burst. Tests (and anything that must read the graph
 *  straight after an edit) call this instead of waiting. */
export function flushLinkedCurves(): void {
  scheduled = false;
  const prev = pendingPrev;
  pendingPrev = null;
  if (prev) sync(useApp.getState().datasets, prev);
}

/** Install the watcher (idempotent) and bring every graph in step now. */
export function watchLinkedCurves(): void {
  if (!watching) {
    watching = true;
    useApp.subscribe((s, prev) => {
      if (s.datasets === prev.datasets || !s.datasets.some((d) => d.linkedCurves)) return;
      pendingPrev ??= prev.datasets;
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flushLinkedCurves);
      }
    });
  }
  sync(useApp.getState().datasets);
}
