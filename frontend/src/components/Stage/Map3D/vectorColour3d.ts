// 3-D VECTOR colour from a column: which request rows can be coloured and how.
// Mirrors `vector_colour_rows` / `vector_colour_plan` in
// `calc/figure_map3d_colour.py`, pinned by `tests/fixtures/wire/plot3d_kinds.json`.
// A number column (`vec_cval`) maps through the colormap over the DRAWN arrows'
// own extent with a colour bar titled `vec_cval_label`; a categorical one
// (`vec_group`, an index into `vec_group_names`, at most `MAX_GROUPS`) takes the
// scatter palette and a legend. A row whose colour value is a gap is not drawn.
// Pure.

import type { MapFigureSpec } from "../../../lib/api/mapFigure";
import type { BarColour } from "./barColour3d";
import { MAX_GROUPS } from "./scatterExtras3d";

const fin = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Whether a vector request colours its arrows from a column. */
export const vectorColourRequested = (b: MapFigureSpec): boolean => b.vec_cval != null || b.vec_group != null;

/** Per request row: is its colour value usable; or the refusal. `n`: the rows given. */
export function vectorColourRows(b: MapFigureSpec, n: number): boolean[] | { error: string } {
  if (b.vec_cval != null && b.vec_group != null) return { error: "colour vectors by a column or by categories, not both: send vec_cval or vec_group" };
  if (b.vec_by_length || b.vec_color != null) {
    return { error: "colour vectors from a column, by length or with one fixed colour, not more than one: send vec_cval, vec_group, vec_by_length or vec_color" };
  }
  const names = b.vec_group_names ?? [];
  if (b.vec_cval != null) {
    if (b.vec_cval.length !== n) return { error: `vec_cval must have one value per row (${n}), got ${b.vec_cval.length}` };
    return b.vec_cval.map(fin);
  }
  const g = b.vec_group as (number | null)[];
  if (g.length !== n) return { error: `vec_group must have one value per row (${n}), got ${g.length}` };
  if (!(names.length >= 1 && names.length <= MAX_GROUPS)) {
    return { error: `3-D vectors take 1 to ${MAX_GROUPS} colour categories; this column has ${names.length} (pick a column with fewer levels)` };
  }
  return g.map((c) => typeof c === "number" && Number.isInteger(c) && c >= 0 && c < names.length);
}

/** The colours of the drawn arrows (`rows`: the request rows that were drawn). */
export function vectorColourPlan(b: MapFigureSpec, rows: number[]): BarColour {
  const names = b.vec_group_names ?? [];
  if (b.vec_cval != null) {
    const v = b.vec_cval;
    return { values: Float64Array.from(rows, (i) => v[i] as number), codes: null, names, used: [], colorLabel: b.vec_cval_label ?? "", groupLabel: "", dropped: 0 };
  }
  const g = b.vec_group as number[];
  const codes = Int16Array.from(rows, (i) => g[i]);
  return { values: null, codes, names, used: [...new Set(codes)].sort((p, q) => p - q), colorLabel: "", groupLabel: b.vec_group_label ?? "", dropped: 0 };
}
