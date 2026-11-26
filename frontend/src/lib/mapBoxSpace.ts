// A box drawn on ANY 2-D map, not only an RSM axis pair. The Box tool stores a
// `RoiRect` in the space it was drawn in; for the two RSM views that is
// "angular" or "q" (`CutSpace`), and for every other map it is "map": the box
// then lives on the map's two displayed channels, named by label in
// `RoiRect.axes`, so it only ever shows over, or applies to, those exact axes
// (a box is never reinterpreted on other columns, the same rule as no silent
// angular <-> Q conversion).
//
// A "map" box is a working shape only: it is never saved as a named ROI (the
// project codec only knows the two RSM spaces) and it is never sent to an RSM
// cut route. What can use it: the local preview, and the lazy workshops that
// take bounds (map analysis, map operations), through `resolveMapBoxAxes`.
// Pure (no React, no store).

import type { CutSpace } from "./mapcuts";
import { mapColumns, rsmAxisKeys } from "./mapdataFetch";
import type { RoiRect } from "./roi";
import type { BoxCols } from "./roiMath";
import type { DataStruct } from "./types";

export type RoiSpace = CutSpace | "map";

/** The two displayed channels' labels, or null when a key is out of range. */
export function mapAxesOf(labels: readonly string[], keys: readonly [number, number, number]): [string, string] | null {
  const x = labels[keys[0]];
  const y = labels[keys[1]];
  return x === undefined || y === undefined ? null : [x, y];
}

export const sameAxes = (a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean =>
  !!a && !!b && a[0] === b[0] && a[1] === b[1];

/** Flat x / y / value columns of the displayed channels (`data` is the map's
 *  own column set, `mapColumns(ds)`), the shape `boxProfileLocal` expects. */
export function genericBoxCols(data: DataStruct, keys: readonly [number, number, number]): BoxCols {
  const n = data.values.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const intensity = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const row = data.values[i]!;
    x[i] = row[keys[0]]!;
    y[i] = row[keys[1]]!;
    intensity[i] = row[keys[2]]!;
  }
  return { x, y, intensity, mapShape: null };
}

export type ResolvedAxes = { cols: [number, number]; error?: undefined } | { error: string; cols?: undefined };

/** `xy` plus the value column a map tool needs with them: `zPick` when it is a
 *  real column apart from the two axes, else the first other column. Null when
 *  the dataset has no third column to offer. */
export function withValueColumn(data: DataStruct, xy: readonly [number, number], zPick?: number): [number, number, number] | null {
  const free = (c: number): boolean => c >= 0 && c < data.labels.length && c !== xy[0] && c !== xy[1];
  if (zPick !== undefined && free(zPick)) return [xy[0], xy[1], zPick];
  const z = data.labels.findIndex((_, i) => free(i));
  return z < 0 ? null : [xy[0], xy[1], z];
}

/** The columns of `data` (the dataset itself, as the workshops index it) that a "map" box's two axes name, or why it cannot be
 *  applied here. A label that is missing or appears twice is refused, never
 *  guessed. */
export function resolveMapBoxAxes(data: DataStruct, axes: readonly [string, string] | undefined): ResolvedAxes {
  if (!axes) return { error: "The box carries no axes; draw it again on the map." };
  const shown = mapColumns(data).labels;
  const shift = data.metadata["is2D"] === true ? 0 : 1;
  const cols: number[] = [];
  for (const name of axes) {
    const hits = shown.flatMap((l, i) => (l === name ? [i] : []));
    if (hits.length !== 1) {
      return { error: `The box was drawn on "${name}", which ${hits.length === 0 ? "this map does not have" : "is ambiguous here (two columns share the label)"}; type the bounds instead.` };
    }
    cols.push(hits[0]! - shift);
  }
  if (cols.some((c) => c < 0)) {
    return { error: "The box uses the worksheet's X column (its row axis), which map tools cannot read as a map axis; type the bounds instead." };
  }
  if (cols[0] === cols[1]) return { error: "The box's two axes are the same column; draw it again." };
  return { cols: [cols[0]!, cols[1]!] };
}

/** The X / Y / value columns of `data` a drawn box applies to: an RSM box's own
 *  pair, or a plain-map box's named axes plus a value column (`zPick` if usable).
 *  A string is the reason it cannot be applied; null = an RSM pair this dataset
 *  does not have. */
export function boxColumns(data: DataStruct, rect: RoiRect, zPick?: number): [number, number, number] | string | null {
  if (rect.space !== "map") return rsmAxisKeys(data.labels, String(data.metadata?.["axis1_name"] ?? "Omega"), rect.space);
  const r = resolveMapBoxAxes(data, rect.axes);
  if (r.error !== undefined) return r.error;
  return withValueColumn(data, r.cols, zPick) ?? "This map has no third column to use as the value; type the bounds instead.";
}
