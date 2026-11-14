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

import { assembleLinkedCurves, linkedGraphYTitle } from "../lib/linkedCurves";
import { rowStateIdentity } from "../lib/rowstate";
import type { Dataset, DataStruct } from "../lib/types";
import { useApp } from "./useApp";

/** A source's identity for change detection: rows, exclusions, filter, its
 *  type overrides (they decide which filter rows apply) and its name (the
 *  legend follows it). */
type SourceStamp = readonly unknown[] | null;
const stampOf = (d: Dataset | undefined): SourceStamp => (d ? [...rowStateIdentity(d), d.channelTypes, d.name] : null);

/** `cyclic`: assembled while on a graph <-> graph cycle (fail closed: empty
 *  curves) -- in step as long as the curve list is unchanged and it is still
 *  on a cycle, since its sources are themselves empty cycle members. */
const assembledFrom = new WeakMap<DataStruct, { curves: string; sources: SourceStamp[]; cyclic: boolean }>();

function sameStamp(now: SourceStamp, then: SourceStamp): boolean {
  return now === then || (now !== null && then !== null && now.length === then.length && now.every((v, k) => v === then[k]));
}

function inStep(graph: Dataset, byId: Map<string, Dataset>, cyclic: boolean): boolean {
  const rec = assembledFrom.get(graph.data);
  if (!rec || rec.curves !== JSON.stringify(graph.linkedCurves) || rec.cyclic !== cyclic) return false;
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
  let changed = false;
  for (const g of order) {
    const d = latest.get(g.id)!;
    const onCycle = cyclic.has(d.id);
    if (inStep(d, latest, onCycle)) continue;
    changed = true;
    const curves = d.linkedCurves!;
    const live = onCycle ? curves.map((c) => ({ ...c, yKey: -1 })) : curves;
    const data = assembleLinkedCurves(live, [...latest.values()], d.data);
    assembledFrom.set(data, { curves: JSON.stringify(curves), sources: curves.map((c) => stampOf(latest.get(c.datasetId))), cyclic: onCycle });
    latest.set(d.id, { ...d, data });
  }
  return changed ? datasets.map((d) => latest.get(d.id)!) : null;
}

/** Mark `graph.data` as assembled from the current `datasets` (a graph the
 *  caller just built itself), so the watcher does not rebuild it again. */
export function noteAssembled(graph: Dataset, datasets: readonly Dataset[]): void {
  const byId = new Map(datasets.map((d) => [d.id, d]));
  assembledFrom.set(graph.data, {
    curves: JSON.stringify(graph.linkedCurves),
    sources: (graph.linkedCurves ?? []).map((c) => stampOf(byId.get(c.datasetId))),
    cyclic: false,
  });
}

let watching = false;

function sync(datasets: readonly Dataset[], prev?: readonly Dataset[]): void {
  if (!datasets.some((d) => d.linkedCurves)) return;
  const next = relinkedDatasets(datasets);
  if (!next) return;
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

/** Install the watcher (idempotent) and bring every graph in step now. */
export function watchLinkedCurves(): void {
  if (!watching) {
    watching = true;
    useApp.subscribe((s, prev) => {
      if (s.datasets !== prev.datasets) sync(s.datasets, prev.datasets);
    });
  }
  sync(useApp.getState().datasets);
}
