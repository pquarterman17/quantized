// 3-D BAR colour from a column: which rows draw a bar and what colours them.
// Mirrors `calc/figure_map3d_colour.py` (`plan_bar_colour`), pinned together by
// `tests/fixtures/wire/plot3d_kinds.json`. A number column (`bar_cval`) is
// coloured through the colormap over its own extent with a colour bar; a
// categorical one (`bar_group`, an index into `bar_group_names`, at most
// `MAX_GROUPS`) takes the scatter's palette and a legend. A row with a gap in
// x, y, z or the colour column is not drawn. Pure.

import type { MapFigureSpec } from "../../../lib/api/mapFigure";
import { MAX_GROUPS } from "./scatterExtras3d";

export interface BarColour {
  /** Per drawn bar: the column's value (number column) or its category index. */
  values: Float64Array | null;
  codes: Int16Array | null;
  names: string[];
  /** Category indices that have a drawn bar (legend order). */
  used: number[];
  colorLabel: string;
  groupLabel: string;
  dropped: number;
}

const fin = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Whether a bar request colours its bars from a column. */
export const barColourRequested = (b: MapFigureSpec): boolean => b.bar_cval != null || b.bar_group != null;

/** The request rows that draw a bar, with their colours; null when no column is
 *  asked for, else the refusal (the route's own, word for word). */
export function planBarColour(b: MapFigureSpec): { rows: number[]; colour: BarColour } | { error: string } | null {
  if (!barColourRequested(b)) return null;
  if (b.contour_source !== "points") return { error: "a bar colour column needs contour_source='points' (the bars are the rows)" };
  const xa = b.x_axis ?? [], ya = b.y_axis ?? [], za = b.z_values;
  if (!za) return { error: "z_values is required when contour_source='points'" };
  if (xa.length !== ya.length || xa.length !== za.length) {
    return { error: `x_axis/y_axis/z_values must have the same length, got ${xa.length}/${ya.length}/${za.length}` };
  }
  if (b.bar_cval != null && b.bar_group != null) return { error: "colour bars by a column or by categories, not both: send bar_cval or bar_group" };
  if (b.bar_color != null) return { error: "colour bars from a column or with one fixed colour, not both: send bar_cval, bar_group or bar_color" };
  const n = xa.length;
  const names = b.bar_group_names ?? [];
  const col = (b.bar_cval ?? b.bar_group) as (number | null)[];
  if (col.length !== n) return { error: `${b.bar_cval != null ? "bar_cval" : "bar_group"} must have one value per row (${n}), got ${col.length}` };
  if (b.bar_group != null && !(names.length >= 1 && names.length <= MAX_GROUPS)) {
    return { error: `a 3-D bar plot takes 1 to ${MAX_GROUPS} colour categories; this column has ${names.length} (pick a column with fewer levels)` };
  }
  const rows: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!(fin(xa[i]) && fin(ya[i]) && fin(za[i]))) continue;
    const v = col[i];
    if (b.bar_cval != null ? !fin(v) : !(typeof v === "number" && Number.isInteger(v) && v >= 0 && v < names.length)) continue;
    rows.push(i);
  }
  const colour: BarColour = {
    values: b.bar_cval != null ? Float64Array.from(rows, (i) => col[i] as number) : null,
    codes: b.bar_group != null ? Int16Array.from(rows, (i) => col[i] as number) : null,
    names, used: [], colorLabel: b.bar_cval_label ?? "", groupLabel: b.bar_group_label ?? "", dropped: n - rows.length,
  };
  if (colour.codes) colour.used = [...new Set(colour.codes)].sort((p, q) => p - q);
  return { rows, colour };
}
