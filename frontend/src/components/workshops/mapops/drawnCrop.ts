// Map operations: a rectangle drawn on the map (the Box tool's `mapRoi`)
// becomes the crop op's four bounds. Pure (no React, no store): the drawn box
// is SNAPPED to grid cells, then the same `xmin/xmax/ymin/ymax` a user would
// type go through the same crop op and recipe (nothing new on the server).
//
// Snap rule (provisional, owner to confirm): each edge moves to the NEAREST
// grid-cell centre of its axis (ties go to the lower cell), so a drag that
// covers part of a cell keeps that cell and a tiny box is one cell, never
// empty. The crop op's bounds are inclusive, so the snapped centres keep
// exactly the cells from the first snapped centre to the last.

import { boxColumns } from "../../../lib/mapBoxSpace";
import type { RoiRect } from "../../../lib/roi";
import type { DataStruct } from "../../../lib/types";

export interface DrawnCrop {
  /** The X / Y / value columns the drawn box lives on (the map's displayed space). */
  cols: [number, number, number];
  xmin: number; xmax: number; ymin: number; ymax: number;
}

/** Sorted distinct finite values of a column; values within 1e-9 of the span merge. */
export function gridAxis(data: DataStruct, col: number): number[] {
  const vals: number[] = [];
  for (const row of data.values) {
    const v = row?.[col];
    if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
  }
  vals.sort((a, b) => a - b);
  if (vals.length === 0) return [];
  const tol = (vals[vals.length - 1]! - vals[0]!) * 1e-9;
  const out: number[] = [vals[0]!];
  for (const v of vals) if (v - out[out.length - 1]! > tol) out.push(v);
  return out;
}

/** The grid value nearest `v` (axis ascending, non-empty); ties go lower. */
export function nearestCell(axis: number[], v: number): number {
  let lo = 0, hi = axis.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (axis[mid]! <= v) lo = mid; else hi = mid;
  }
  if (axis.length === 1) return axis[0]!;
  return v - axis[lo]! <= axis[hi]! - v ? axis[lo]! : axis[hi]!;
}

/** The snapped crop bounds for a drawn box, or the reason it cannot be used. */
export function snapDrawnRegion(data: DataStruct, rect: RoiRect | null, zPick?: number): { crop: DrawnCrop; error?: undefined } | { error: string; crop?: undefined } {
  if (!rect) return { error: "Draw a box on the map first (Box tool in the map toolbar)." };
  const keys = boxColumns(data, rect, zPick);
  if (typeof keys === "string") return { error: keys };
  if (!keys) return { error: `The box was drawn in ${rect.space === "q" ? "Q" : "angular"} space, but this map has no such axes.` };
  const nums = [rect.x0, rect.x1, rect.y0, rect.y1];
  if (!nums.every(Number.isFinite)) return { error: "The drawn box is not a valid rectangle." };
  const xs = gridAxis(data, keys[0]);
  const ys = gridAxis(data, keys[1]);
  if (xs.length === 0 || ys.length === 0) return { error: "The map has no finite cells to crop." };
  const [xa, xb] = [Math.min(rect.x0, rect.x1), Math.max(rect.x0, rect.x1)];
  const [ya, yb] = [Math.min(rect.y0, rect.y1), Math.max(rect.y0, rect.y1)];
  if (xb < xs[0]! || xa > xs[xs.length - 1]! || yb < ys[0]! || ya > ys[ys.length - 1]!) {
    return { error: "The drawn box lies outside the map." };
  }
  const crop: DrawnCrop = {
    cols: keys,
    xmin: nearestCell(xs, xa), xmax: nearestCell(xs, xb),
    ymin: nearestCell(ys, ya), ymax: nearestCell(ys, yb),
  };
  // The crop op needs at least two cells along each axis.
  if (crop.xmin === crop.xmax || crop.ymin === crop.ymax) {
    return { error: "The drawn box snaps to a single cell column or row; draw a larger box (the crop needs at least 2 cells per axis)." };
  }
  return { crop };
}

/** Bound text as the form's number fields hold it. */
export const boundText = (v: number): string => String(Number(v.toPrecision(12)));
