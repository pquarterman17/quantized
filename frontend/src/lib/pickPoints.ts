// Pick points from a graph into a sheet (Origin's Pick Points; gap plan item
// 22). The Pick tool turns a click into the DATA point nearest to it; this
// module is the pure part: naming that point's source (sheet, row, columns),
// reading its values from the SOURCE (never from pixels or from drawn offsets
// such as a waterfall shift), and building the worksheet the picks become,
// with the provenance of every row.
//
// Row state: a point whose source row is excluded (masked) is refused, read
// through `rowstate.isRowExcluded`, never re-derived. A row hidden by a data
// filter is not drawn, so it cannot be hit.

import { curveBindingAt, type RebindState } from "./curveRebind";
import { linkedRowSources } from "./linkedCurves";
import { isRowExcluded } from "./rowstate";
import type { DataStruct, Dataset } from "./types";

export interface PickedPoint {
  datasetId: string;
  datasetName: string;
  /** The source row (0-based) and the columns it was read through (`xKey` null = the sheet's own X). */
  row: number;
  xKey: number | null;
  yKey: number;
  x: number;
  y: number;
  xLabel: string;
  yLabel: string;
}

const same = (a: PickedPoint, b: PickedPoint): boolean => a.datasetId === b.datasetId && a.row === b.row && a.xKey === b.xKey && a.yKey === b.yKey;

/** `points` plus `p`, or `points` itself when `p` is already there. */
export const withPick = (points: readonly PickedPoint[], p: PickedPoint): readonly PickedPoint[] => (points.some((q) => same(q, p)) ? points : [...points, p]);

const colName = (src: Dataset, key: number | null, unit: boolean): string => {
  const m = src.data.metadata;
  const name = key === null ? String(m?.x_column_name ?? "X") : src.data.labels[key] || `col ${key + 1}`;
  const u = key === null ? String(m?.x_column_unit ?? "") : (src.data.units[key] ?? "");
  return unit && u ? `${name} (${u})` : name;
};

/** The point behind drawn row `row` of the focused graph `graph` on display
 *  series `channel`, or why it can't be picked. `row` is the graph's own row
 *  (traced through a reduced payload by the caller). */
export function resolvePick(s: RebindState, graph: Dataset, channel: number, row: number): PickedPoint | { refused: string } {
  const bound = curveBindingAt(s, channel);
  if (!bound) return { refused: "that curve has no sheet of its own to pick from" };
  let srcId = bound.datasetId;
  let srcRow = row;
  if (graph.linkedCurves) {
    const from = linkedRowSources(graph.linkedCurves, s.datasets)[row];
    if (!from) return { refused: "that point's source row can't be found" };
    srcId = from.id;
    srcRow = from.row;
  }
  const src = s.datasets.find((d) => d.id === srcId);
  if (!src || src.pending) return { refused: "that point's sheet is not loaded" };
  if (isRowExcluded(src, srcRow)) return { refused: `row ${srcRow + 1} of “${src.name}” is masked: unmask it to pick it` };
  const x = bound.xKey === null ? src.data.time[srcRow] : src.data.values[srcRow]?.[bound.xKey];
  const y = src.data.values[srcRow]?.[bound.yKey];
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return { refused: "that point has no finite value" };
  return {
    datasetId: src.id, datasetName: src.name, row: srcRow, xKey: bound.xKey, yKey: bound.yKey, x, y,
    xLabel: colName(src, bound.xKey, true), yLabel: colName(src, bound.yKey, true),
  };
}

/** The worksheet the picks become: X and Y as picked, the source row (1-based,
 *  as the worksheet numbers rows), and per-row provenance in `metadata.picked_points`. */
export function pickedData(points: readonly PickedPoint[]): DataStruct {
  const one = <T>(f: (p: PickedPoint) => T): T | null => (points.every((p) => f(p) === f(points[0])) ? f(points[0]) : null);
  return {
    time: points.map((p) => p.x),
    values: points.map((p) => [p.y, p.row + 1]),
    labels: [one((p) => p.yLabel) ?? "Y", "Source row"],
    units: ["", ""],
    metadata: {
      x_column_name: one((p) => p.xLabel) ?? "X",
      x_column_unit: "",
      source: "picked",
      picked_points: points.map((p) => ({ dataset_id: p.datasetId, dataset: p.datasetName, row: p.row, x_column: p.xLabel, y_column: p.yLabel })),
    },
  };
}
