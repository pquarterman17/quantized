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

import { assembleLinkedCurves } from "../lib/linkedCurves";
import { rowStateIdentity } from "../lib/rowstate";
import type { Dataset, DataStruct } from "../lib/types";
import { useApp } from "./useApp";

/** A source's identity for change detection: rows, exclusions, filter. */
type SourceStamp = readonly [unknown, unknown, unknown] | null;
const stampOf = (d: Dataset | undefined): SourceStamp => (d ? rowStateIdentity(d) : null);

const assembledFrom = new WeakMap<DataStruct, { curves: string; sources: SourceStamp[] }>();

function inStep(graph: Dataset, byId: Map<string, Dataset>): boolean {
  const rec = assembledFrom.get(graph.data);
  if (!rec || rec.curves !== JSON.stringify(graph.linkedCurves)) return false;
  const ids = graph.linkedCurves!.map((c) => c.datasetId);
  return ids.every((id, i) => {
    const now = stampOf(byId.get(id));
    const then = rec.sources[i];
    return now === then || (now !== null && then !== null && now.every((v, k) => v === then[k]));
  });
}

/** Re-assemble every out-of-step graph in `datasets`; null when all are current. */
export function relinkedDatasets(datasets: readonly Dataset[]): Dataset[] | null {
  const byId = new Map(datasets.map((d) => [d.id, d]));
  let changed = false;
  const next = datasets.map((d) => {
    if (!d.linkedCurves || inStep(d, byId)) return d;
    changed = true;
    const data = assembleLinkedCurves(d.linkedCurves, datasets);
    assembledFrom.set(data, {
      curves: JSON.stringify(d.linkedCurves),
      sources: d.linkedCurves.map((c) => stampOf(byId.get(c.datasetId))),
    });
    return { ...d, data };
  });
  return changed ? next : null;
}

/** Mark `graph.data` as assembled from the current `datasets` (a graph the
 *  caller just built itself), so the watcher does not rebuild it again. */
export function noteAssembled(graph: Dataset, datasets: readonly Dataset[]): void {
  const byId = new Map(datasets.map((d) => [d.id, d]));
  assembledFrom.set(graph.data, {
    curves: JSON.stringify(graph.linkedCurves),
    sources: (graph.linkedCurves ?? []).map((c) => stampOf(byId.get(c.datasetId))),
  });
}

let watching = false;

function sync(datasets: readonly Dataset[]): void {
  if (!datasets.some((d) => d.linkedCurves)) return;
  const next = relinkedDatasets(datasets);
  if (next) useApp.setState({ datasets: next });
}

/** Install the watcher (idempotent) and bring every graph in step now. */
export function watchLinkedCurves(): void {
  if (!watching) {
    watching = true;
    useApp.subscribe((s, prev) => {
      if (s.datasets !== prev.datasets) sync(s.datasets);
    });
  }
  sync(useApp.getState().datasets);
}
