// A LIVE multi-dataset graph (origin gap audit 2 #1).
//
// "Plot selected together" used to copy its sources into a frozen `overlay
// (N)` dataset: editing a source cell, masking a row or re-importing never
// reached the graph. A linked graph keeps the per-curve references instead --
// `Dataset.linkedCurves`, one (datasetId, xKey, yKey, label) per curve -- and
// its `data` is only a cache, re-assembled from the live sources whenever one
// changes (store/linkedCurvesSync.ts). Every window, figure document, export
// and .dwk binds to the graph dataset exactly as to any other, so none of
// them needed a second, multi-source code path.
//
// Layout is the segment concatenation lib/originOverlay.ts and
// lib/perSeriesX.ts render: one block of rows per distinct (source, X), in
// first-curve order; a curve's column holds values only inside its own block
// (NaN elsewhere); never a sorted X union, so a hysteresis loop keeps its row
// order. A source's dropped rows (exclusion + filter) are NaN in its curves,
// so a mask reaches the graph. A curve whose source is gone (deleted) or
// whose Y column no longer exists keeps its column, empty -- the graph never
// rebinds it to another dataset or column (fail closed).
//
// Pure; loaded only by the lazy graph actions and the sync watcher.

import { droppedRows } from "./rowstate";
import { sharedAxisTitle } from "./sharedAxisTitle";
import type { Dataset, DataStruct, LinkedCurve } from "./types";

/** The display name (and unit) of a source's X column. */
function xQuantity(ds: Dataset, xKey: number | null): [string, string] {
  const m = ds.data.metadata ?? {};
  if (xKey === null) return [String(m.x_column_long || m.x_column_name || "x"), String(m.x_column_unit ?? "")];
  return [ds.data.labels[xKey] ?? `col ${xKey + 1}`, ds.data.units[xKey] ?? ""];
}

/** The graph's DataStruct for `curves` over the CURRENT `datasets`. */
export function assembleLinkedCurves(curves: readonly LinkedCurve[], datasets: readonly Dataset[]): DataStruct {
  const byId = new Map(datasets.map((d) => [d.id, d]));
  const blocks: { ds: Dataset; xKey: number | null; start: number }[] = [];
  const blockOf = new Map<string, number>();
  let total = 0;
  const curveBlock = curves.map((c) => {
    const ds = byId.get(c.datasetId);
    const width = ds?.data.labels.length ?? 0;
    if (!ds || c.yKey < 0 || c.yKey >= width || (c.xKey !== null && (c.xKey < 0 || c.xKey >= width))) return -1;
    const key = `${c.datasetId}#${c.xKey}`;
    if (!blockOf.has(key)) {
      blockOf.set(key, blocks.length);
      blocks.push({ ds, xKey: c.xKey, start: total });
      total += ds.data.time.length;
    }
    return blockOf.get(key)!;
  });
  const time = new Array<number>(total).fill(NaN);
  const values = Array.from({ length: total }, () => new Array<number>(curves.length).fill(NaN));
  for (const b of blocks) {
    const src = b.ds.data;
    for (let r = 0; r < src.time.length; r++) {
      time[b.start + r] = b.xKey === null ? src.time[r] : (src.values[r]?.[b.xKey] ?? NaN);
    }
  }
  const dropped = new Map(blocks.map((b) => [b.ds.id, droppedRows(b.ds)]));
  curves.forEach((c, col) => {
    const bi = curveBlock[col];
    if (bi < 0) return;
    const b = blocks[bi];
    const skip = dropped.get(b.ds.id)!;
    for (let r = 0; r < b.ds.data.time.length; r++) {
      if (!skip.has(r)) values[b.start + r][col] = b.ds.data.values[r]?.[c.yKey] ?? NaN;
    }
  });
  // One X axis: name every distinct X quantity ("2-Theta (deg)"; "T (K) / H (Oe)").
  const xs = new Map(blocks.map((b) => xQuantity(b.ds, b.xKey)).map(([n, u]) => [`${n}\0${u}`, [n, u] as const]));
  const pairs = [...xs.values()];
  const [xName, xUnit] =
    pairs.length === 1 ? pairs[0] : [pairs.map(([n, u]) => (u ? `${n} (${u})` : n)).join(" / "), ""];
  // A column is named by its curve label (which dataset; unique, so the
  // backend's DataStruct never renames a repeat to "Value (2)"); the source
  // QUANTITY is the column's Comment in the worksheet.
  const src = (i: number) => (curveBlock[i] < 0 ? undefined : byId.get(curves[i].datasetId)!.data);
  const names = curves.map((_, i) => `c${i}`);
  return {
    time,
    values,
    labels: curves.map((c) => c.label),
    units: curves.map((c, i) => src(i)?.units[c.yKey] ?? ""),
    metadata: {
      source_format: "linked-graph",
      x_column_name: xName || "x",
      x_column_long: xName,
      x_column_unit: xUnit,
      origin_column_names: names,
      column_comments: Object.fromEntries(curves.map((c, i) => [names[i], src(i)?.labels[c.yKey] ?? "(missing)"])),
    },
  };
}

/** The graph's Y title over its sources' QUANTITIES ("Moment (emu)"; mixed:
 *  "R (ohm) / V (V)"). Its columns are named by curve (which dataset), so the
 *  auto title would otherwise list dataset names instead of what is plotted. */
export function linkedGraphYTitle(curves: readonly LinkedCurve[], datasets: readonly Dataset[]): string {
  const byId = new Map(datasets.map((d) => [d.id, d.data]));
  const series = curves.flatMap((c) => {
    const src = byId.get(c.datasetId);
    const label = src?.labels[c.yKey];
    return src && label !== undefined ? [{ label, unit: src.units[c.yKey] ?? "" }] : [];
  });
  return sharedAxisTitle(series) ?? "";
}

/** One curve per dataset (its default X against `yKey`), labelled by dataset name. */
export function curvesFor(datasets: readonly Dataset[], yKeyOf: (ds: Dataset) => number | null): LinkedCurve[] {
  return datasets.flatMap((ds) => {
    const yKey = yKeyOf(ds);
    return yKey === null ? [] : [{ datasetId: ds.id, xKey: null, yKey, label: ds.name }];
  });
}

/** Validate a parsed .dwk `linkedCurves` entry; anything malformed is dropped. */
export function sanitizeLinkedCurves(raw: unknown): LinkedCurve[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  // -1 = the source column was removed (remapLinkedCurveSources): kept, drawn empty.
  const ok = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= -1;
  const out = raw.flatMap((c): LinkedCurve[] => {
    const r = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
    if (typeof r.datasetId !== "string" || !ok(r.yKey) || !(r.xKey === null || ok(r.xKey))) return [];
    return [{ datasetId: r.datasetId, xKey: r.xKey, yKey: r.yKey, label: typeof r.label === "string" ? r.label : "" }];
  });
  return out.length ? out : undefined;
}
