// Keeps every LIVE graph's cached `data` in step with its sources (gap audit
// 2 #1, lib/linkedCurves.ts). One store subscription; a change never rebuilds
// inside the listener -- it schedules ONE pass on a microtask (review finding
// 1: a setState from inside the listener recursed). A pass walks the graphs in
// build order (a graph after the graphs it sources, so a graph-of-graphs sees
// this pass's rebuild), rebuilds only a graph whose INPUTS changed, and lands
// every rebuild in one setState. A graph on a dependency cycle draws empty.
//
// A graph's inputs, compared by identity: its curve list, and per source the
// data, the row state that decides which rows draw (excluded rows, the local
// filter and the channel types the filter's applicability reads -- review
// finding 5), the name (legend) and the designations/roles (own X). A cyclic
// graph's stamp is its curve list alone: it is empty whatever its sources hold,
// and stamping their (rebuilt) data would ping-pong forever.
//
// Loaded on demand: store/linkedCurvesBoot.ts installs it once a graph exists
// (a created one, or one in a loaded/restored workspace -- the .dwk re-links
// on load because a fresh install has no stamps).

import { assembleLinkedCurves, graphBuildOrder } from "../lib/linkedCurves";
import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

let installed = false;
let scheduled = false;
let lastDatasets: readonly Dataset[] | null = null;
const stamps = new Map<string, readonly unknown[]>();

function stampOf(g: Dataset, lookup: (id: string) => Dataset | undefined, cyclic: boolean): unknown[] {
  if (cyclic) return [g.linkedCurves, "cyclic"];
  const out: unknown[] = [g.linkedCurves];
  for (const id of new Set(g.linkedCurves!.map((c) => c.datasetId))) {
    const s = lookup(id);
    out.push(id, s?.data, s?.excludedRows, s?.filter, s?.channelTypes, s?.name, s?.columnDesignations, s?.channelRoles);
  }
  return out;
}

const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** One rebuild pass (exported for tests; the subscription schedules it). */
export function rebuildLinkedGraphs(): void {
  const { datasets } = useApp.getState();
  if (datasets === lastDatasets) return;
  lastDatasets = datasets;
  const byId = new Map(datasets.map((d) => [d.id, d]));
  for (const id of stamps.keys()) if (!byId.get(id)?.linkedCurves) stamps.delete(id);
  const { order, cyclic } = graphBuildOrder(datasets);
  const rebuilt = new Map<string, Dataset>();
  const lookup = (id: string) => rebuilt.get(id) ?? byId.get(id);
  for (const g of order) {
    const loop = cyclic.has(g.id);
    const stamp = stampOf(g, lookup, loop);
    const prev = stamps.get(g.id);
    if (prev && same(prev, stamp)) continue;
    rebuilt.set(g.id, { ...g, data: assembleLinkedCurves(g.linkedCurves!, lookup, loop) });
    stamps.set(g.id, stamp);
  }
  if (rebuilt.size === 0) return;
  useApp.setState((s) => {
    const next = s.datasets.map((d) => (rebuilt.has(d.id) && d === byId.get(d.id) ? rebuilt.get(d.id)! : d));
    lastDatasets = null; // re-check after this lands (the stamps make it a no-op)
    return { datasets: next };
  });
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    rebuildLinkedGraphs();
  });
}

/** Install the sync (idempotent) and run a first pass now. */
export function installLinkedCurvesSync(): void {
  if (!installed) {
    installed = true;
    useApp.subscribe(schedule);
  }
  rebuildLinkedGraphs();
}

/** Tests: forget every stamp (a fresh session). */
export function resetLinkedCurvesSyncForTests(): void {
  stamps.clear();
  lastDatasets = null;
}
