// LIVE multi-dataset graphs (Origin-gap audit 2, #1). A graph is an ordinary
// Library dataset carrying `linkedCurves`: one entry per curve naming the
// source dataset, its X column (null = the source curve's OWN X, Origin's
// nearest-preceding-X rule) and its Y column. The graph's `data` is only a
// CACHE that `assembleLinkedCurves` rebuilds from the sources
// (store/linkedCurvesSync.ts runs it whenever an input changes), so plot
// windows, figures, export, fitting and the .dwk all bind to the graph like
// to any dataset -- there is no second render path.
//
// The layout is the segment-concatenated one every multi-X plot here uses
// (lib/originOverlay.ts, lib/perSeriesX.ts): one row block per distinct
// (source, X), each the source's own rows in their own order -- never a
// sorted X union, so a hysteresis loop keeps its acquisition order -- and a
// curve has values only inside its own block. A source row the source masks
// or filters out is a NaN gap in that curve's Y (its X stays). A missing
// source or column is an EMPTY curve (`yKey` -1 marks one that can never
// resolve again), never rebound to another dataset or column: fail closed.
//
// Columns carry the source column's quantity and unit (so the Y title names
// the quantity -- lib/sharedAxisTitle.ts) while the legend reads
// `metadata.linked_curve_legends`: the curve's own label when the user gave
// one, else the source's CURRENT name -- so a renamed source renames its curve.
// Pure; loaded only with the graph actions and the sync (never at startup).

import { effectiveDesignations } from "./columnmeta";
import { errorRoleViewDefaults } from "./errorbars";
import { curveXKey, hasFiniteValue } from "./ownXSeries";
import { jointXTitle } from "./perSeriesX";
import { primaryChannel } from "./plotdataExtras";
import { droppedRows } from "./rowstate";
import type { LinkedCurve } from "./linkedCurveTypes";
import type { Dataset, DataStruct } from "./types";

export { relabelCurveColumns, remapCurveColumns } from "./linkedCurveColumns";
export type { LinkedCurve } from "./linkedCurveTypes";

/** A source id that matches no dataset (an unmapped .dwk merge): drawn empty. */
export const UNRESOLVED_SOURCE = "";

type Lookup = (id: string) => Dataset | undefined;

const isCol = (c: unknown, width: number): c is number => Number.isInteger(c) && (c as number) >= 0 && (c as number) < width;

/** The source and (X, Y) columns `c` draws, or null for an empty curve. */
export function resolveCurve(c: LinkedCurve, lookup: Lookup): { src: Dataset; x: number | null; y: number } | null {
  const src = c.datasetId === UNRESOLVED_SOURCE ? undefined : lookup(c.datasetId);
  const width = src?.data.labels.length ?? 0;
  if (!src || !isCol(c.yKey, width) || (c.xKey !== null && !isCol(c.xKey, width))) return null;
  return { src, x: c.xKey ?? curveXKey(src, null, c.yKey), y: c.yKey };
}

/** Rebuild a graph's data from its curves. `empty` draws every curve empty
 *  (a graph on a dependency cycle). Rows = the sum of the BLOCK rows: each
 *  block is built once, for its own curves only. */
export function assembleLinkedCurves(curves: readonly LinkedCurve[], lookup: Lookup, empty = false): DataStruct {
  const resolved = curves.map((c) => (empty ? null : resolveCurve(c, lookup)));
  const blocks: { src: Dataset; x: number | null; curves: number[] }[] = [];
  const index = new Map<string, number>();
  resolved.forEach((r, i) => {
    if (!r) return;
    const key = `${r.src.id}#${r.x}`;
    let b = index.get(key);
    if (b === undefined) index.set(key, (b = blocks.push({ src: r.src, x: r.x, curves: [] }) - 1));
    blocks[b].curves.push(i);
  });
  const time: number[] = [];
  const values: number[][] = [];
  for (const blk of blocks) {
    const d = blk.src.data;
    const dropped = droppedRows(blk.src);
    for (let r = 0; r < d.time.length; r++) {
      const row = d.values[r] ?? [];
      time.push(blk.x === null ? d.time[r] : (row[blk.x] ?? NaN));
      const out = new Array<number>(curves.length).fill(NaN);
      if (!dropped.has(r)) for (const i of blk.curves) out[i] = row[resolved[i]!.y] ?? NaN;
      values.push(out);
    }
  }
  const perSource = new Map<string, number>();
  for (const r of resolved) if (r) perSource.set(r.src.id, (perSource.get(r.src.id) ?? 0) + 1);
  const legends = curves.map((c, i) => {
    const r = resolved[i];
    if (c.label) return c.label;
    if (!r) return "(missing curve)";
    return (perSource.get(r.src.id) ?? 0) > 1 ? `${r.src.name}: ${r.src.data.labels[r.y]}` : r.src.name;
  });
  const xName = (b: (typeof blocks)[number]): string => {
    const m = b.src.data.metadata ?? {};
    return b.x === null ? String(m["x_column_long"] || m["x_column_name"] || "x") : (b.src.data.labels[b.x] ?? "x");
  };
  const xUnit = (b: (typeof blocks)[number]): string =>
    b.x === null ? String(b.src.data.metadata?.["x_column_unit"] ?? "") : (b.src.data.units[b.x] ?? "");
  const x = jointXTitle(blocks.map((b) => [xName(b), xUnit(b)]));
  return {
    time,
    values,
    labels: curves.map((c, i) => (resolved[i] ? (resolved[i]!.src.data.labels[resolved[i]!.y] ?? "") : (c.label ?? "missing"))),
    units: curves.map((_, i) => (resolved[i] ? (resolved[i]!.src.data.units[resolved[i]!.y] ?? "") : "")),
    metadata: {
      source_format: "linked-graph",
      linked_curve_legends: legends,
      x_column_long: x.name || "x",
      x_column_name: x.name || "x",
      x_column_unit: x.unit,
    },
  };
}

// ── dependencies ──────────────────────────────────────────────────────────

/** True when `sourceId`'s curves reach `targetId` (or it IS the target): adding
 *  it to the target would make a cycle (review finding 1). */
export function reachesGraph(sourceId: string, targetId: string, datasets: readonly Dataset[]): boolean {
  const byId = new Map(datasets.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const walk = (id: string): boolean => {
    if (id === targetId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (byId.get(id)?.linkedCurves ?? []).some((c) => walk(c.datasetId));
  };
  return walk(sourceId);
}

/** Graphs in build order (a graph after every graph it sources), and the ids
 *  of graphs on a dependency cycle -- those draw empty (a hand-made .dwk can
 *  name one) rather than recursing forever. Tarjan's SCCs come out
 *  dependencies-first for edges graph -> source. */
export function graphBuildOrder(datasets: readonly Dataset[]): { order: Dataset[]; cyclic: Set<string> } {
  const graphs = new Map(datasets.filter((d) => d.linkedCurves).map((d) => [d.id, d]));
  const order: Dataset[] = [];
  const cyclic = new Set<string>();
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  let counter = 0;
  const strong = (v: string): void => {
    idx.set(v, counter);
    low.set(v, counter++);
    stack.push(v);
    onStack.add(v);
    for (const c of graphs.get(v)!.linkedCurves!) {
      const w = c.datasetId;
      if (!graphs.has(w)) continue;
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) !== idx.get(v)) return;
    const scc: string[] = [];
    let w: string;
    do {
      w = stack.pop()!;
      onStack.delete(w);
      scc.push(w);
    } while (w !== v);
    const selfLoop = graphs.get(v)!.linkedCurves!.some((c) => c.datasetId === v);
    if (scc.length > 1 || selfLoop) scc.forEach((id) => cyclic.add(id));
    for (const id of scc) order.push(graphs.get(id)!);
  };
  for (const id of graphs.keys()) if (!idx.has(id)) strong(id);
  return { order, cyclic };
}

// ── persistence and remapping ─────────────────────────────────────────────

// ── creation ──────────────────────────────────────────────────────────────

/** Origin-style "Graph1, Graph2, …": the next name no dataset holds. */
export function nextGraphName(datasets: readonly Pick<Dataset, "name">[]): string {
  const taken = new Set(datasets.map((d) => d.name));
  let n = 1;
  while (taken.has(`Graph${n}`)) n++;
  return `Graph${n}`;
}

/** The curves "Plot selected together" takes from `ds`: its designated Ys,
 *  each on its own X, when the sheet designates columns (review finding 10);
 *  every curve of a graph; else the one channel its default plot leads with. */
export function defaultCurves(ds: Dataset): LinkedCurve[] {
  if (ds.linkedCurves) return ds.data.labels.map((_, y) => ({ datasetId: ds.id, xKey: null, yKey: y }));
  const designations = effectiveDesignations(ds.data, ds.columnDesignations);
  if (designations.some((g) => g === "X" || g === "Y")) {
    const hidden = new Set(errorRoleViewDefaults(ds).hiddenChannels);
    const ys = ds.data.labels
      .map((_, c) => c)
      .filter((c) => !hidden.has(c) && (designations[c] === "Y" || designations[c] === undefined) && hasFiniteValue(ds.data.values, c));
    if (ys.length) return ys.map((y) => ({ datasetId: ds.id, xKey: null, yKey: y }));
  }
  const y = primaryChannel(ds.data);
  return y == null ? [] : [{ datasetId: ds.id, xKey: null, yKey: y }];
}
