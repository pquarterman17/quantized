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

import { effectiveDesignations } from "./columnmeta";
import { curveX } from "./perSeriesX";
import { droppedRows } from "./rowstate";
import { sharedAxisTitle } from "./sharedAxisTitle";
import type { Dataset, DataStruct, LinkedCurve } from "./types";

/** The display name (and unit) of a source's X column. */
function xQuantity(ds: Dataset, xKey: number | null): [string, string] {
  const m = ds.data.metadata ?? {};
  if (xKey === null) return [String(m.x_column_long || m.x_column_name || "x"), String(m.x_column_unit ?? "")];
  return [ds.data.labels[xKey] ?? `col ${xKey + 1}`, ds.data.units[xKey] ?? ""];
}

/** A curve's legend text: derived from the source's CURRENT name when the
 *  curve carries `labelFrom` (so a rename follows), else the stored label. */
function curveLabel(c: LinkedCurve, ds: Dataset | undefined): string {
  if (!ds || !c.labelFrom) return c.label;
  if (c.labelFrom === "name") return ds.name;
  const col = ds.data.labels[c.yKey];
  return col === undefined ? c.label : `${ds.name}: ${col}`;
}

/** The graph's DataStruct for `curves` over the CURRENT `datasets`. `previous`
 *  (the graph's data being replaced) lends it the presentation-only metadata
 *  a user declared on the graph itself (confirmed error pairings), which a
 *  rebuild must not drop. */
export function assembleLinkedCurves(
  curves: readonly LinkedCurve[],
  datasets: readonly Dataset[],
  previous?: DataStruct,
): DataStruct {
  const byId = new Map(datasets.map((d) => [d.id, d]));
  const blocks: { ds: Dataset; xKey: number | null; start: number; cols: { col: number; yKey: number }[] }[] = [];
  const blockOf = new Map<string, number>();
  let total = 0;
  const curveBlock = curves.map((c, col) => {
    const ds = byId.get(c.datasetId);
    const width = ds?.data.labels.length ?? 0;
    if (!ds || c.yKey < 0 || c.yKey >= width || (c.xKey !== null && (c.xKey < 0 || c.xKey >= width))) return -1;
    const key = `${c.datasetId}#${c.xKey}`;
    let bi = blockOf.get(key);
    if (bi === undefined) {
      bi = blocks.length;
      blockOf.set(key, bi);
      blocks.push({ ds, xKey: c.xKey, start: total, cols: [] });
      total += ds.data.time.length;
    }
    blocks[bi].cols.push({ col, yKey: c.yKey });
    return bi;
  });
  // One row per block row (never per curve); each block writes only its own
  // curves' cells, reading each source row once.
  const time = new Array<number>(total).fill(NaN);
  const values = new Array<number[]>(total);
  const blank = new Array<number>(curves.length).fill(NaN);
  for (const b of blocks) {
    const src = b.ds.data;
    const skip = droppedRows(b.ds);
    for (let r = 0; r < src.time.length; r++) {
      const srcRow = src.values[r];
      const row = blank.slice();
      time[b.start + r] = b.xKey === null ? src.time[r] : (srcRow?.[b.xKey] ?? NaN);
      if (!skip.has(r)) for (const { col, yKey } of b.cols) row[col] = srcRow?.[yKey] ?? NaN;
      values[b.start + r] = row;
    }
  }
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
  const declared = previous?.metadata?.error_roles;
  return {
    time,
    values,
    labels: curves.map((c) => curveLabel(c, byId.get(c.datasetId))),
    units: curves.map((c, i) => src(i)?.units[c.yKey] ?? ""),
    metadata: {
      source_format: "linked-graph",
      x_column_name: xName || "x",
      x_column_long: xName,
      x_column_unit: xUnit,
      origin_column_names: names,
      column_comments: Object.fromEntries(curves.map((c, i) => [names[i], src(i)?.labels[c.yKey] ?? "(missing)"])),
      ...(declared !== undefined ? { error_roles: declared } : {}),
    },
  };
}

/** Does `fromId` draw (directly, or through other graphs) from `targetId`?
 *  True for `fromId === targetId`. Used to refuse a curve that would close a
 *  graph <-> graph cycle. */
export function linkedGraphReaches(datasets: readonly Dataset[], fromId: string, targetId: string): boolean {
  const byId = new Map(datasets.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const stack = [fromId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === targetId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const c of byId.get(id)?.linkedCurves ?? []) stack.push(c.datasetId);
  }
  return false;
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
    return yKey === null ? [] : [{ datasetId: ds.id, xKey: null, yKey, label: ds.name, labelFrom: "name" as const }];
  });
}

/** The curves "Plot together" draws for each dataset, honouring column
 *  designations: a sheet with columns designated Y contributes every one of
 *  them, each against its OWN X (the nearest preceding X, lib/perSeriesX.ts),
 *  named "sheet: column"; a sheet with none contributes `primaryOf` -- unless
 *  that is a designated X/error/label column, then its first plain channel --
 *  named by the sheet. A sheet with nothing plottable contributes nothing. */
export function curvesForDatasets(datasets: readonly Dataset[], primaryOf: (ds: Dataset) => number | null): LinkedCurve[] {
  return datasets.flatMap((ds): LinkedCurve[] => {
    const n = ds.data.labels.length;
    const des = effectiveDesignations(ds.data, ds.columnDesignations).slice(0, n);
    const own = curveX(ds, null);
    // Any designation means the user (or the Origin book) laid the sheet out:
    // every curve channel (a Y, or an undesignated one -- never an X, error or
    // label column) is drawn against its own X.
    const ys = des.some((d) => d === "X" || d === "Y") ? own.flatMap((x, c) => (x === undefined ? [] : [c])) : [];
    if (ys.length > 0) {
      return ys.map((c) => ({
        datasetId: ds.id,
        xKey: own[c] ?? null,
        yKey: c,
        label: `${ds.name}: ${ds.data.labels[c] ?? ""}`,
        labelFrom: "nameCol" as const,
      }));
    }
    const plainChannels = Array.from({ length: n }, (_, c) => c).filter((c) => des[c] === undefined);
    const primary = primaryOf(ds);
    const yKey = primary !== null && primary < n && des[primary] === undefined ? primary : (plainChannels[0] ?? null);
    return yKey === null ? [] : [{ datasetId: ds.id, xKey: own[yKey] ?? null, yKey, label: ds.name, labelFrom: "name" }];
  });
}

export { emptyGraphReason, NO_CURVES_REASON, sanitizeLinkedCurves, UNRESOLVED_SOURCE } from "./linkedCurvesLite";
