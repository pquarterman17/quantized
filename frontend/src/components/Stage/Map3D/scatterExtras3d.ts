// The 3-D SCATTER extras' scene rules, built from the export's own request.
// Each rule mirrors `calc/figure_map3d_scatter.py` (which rows draw, the marker
// diameters, the colour range, the groups, the hull the axes span, the wall
// coordinates) and `tests/fixtures/wire/plot3d_scatter.json` pins the two
// together. Pure; no drawing here.
//
//   * colour by a column: a colour bar over that column's own extent (never the
//     map's z colour limits); colour by groups: one palette colour per group and
//     a legend. Both at once is refused.
//   * size by a column: diameter 3..10 pt linear in the value; a flat column
//     draws the middle size. Without it the plain scatter's marker is kept.
//   * error bars: symmetric, per axis; a non-finite or negative error is not drawn.
//   * wall shadows: the points on the back panes (the face of each axis farther
//     from the viewer), each wall toggleable.

import type { MapFigureSpec } from "../../../lib/api/mapFigure";
import { BOX } from "../../../lib/project3d";
import { padSpan } from "./sceneExt3d";

/** `calc/figure_map3d_scatter.py`: matplotlib's tab10, the size range (pt) and the cap. */
export const GROUP_COLORS = [
  "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
] as const;
export const MAX_GROUPS = GROUP_COLORS.length;
export const SIZE_DIAMETER: readonly [number, number] = [3, 10];
export const WALL_COLOR = "#808080";
export const WALL_ALPHA = 0.35;
export const ERROR_COLOR = "#555555";
/** Half length of an error bar's end cap in BOX units (`figure_map3d_scatter.CAP_HALF`). */
export const CAP_HALF = 0.015;
const MAX_POINTS = 50_000;

type Col = (number | null)[];
type Triple<T> = [T, T, T];

export interface PointExtras {
  /** Per drawn point: the colour column's value, the marker diameter (pt), the group index. */
  color: Float64Array | null;
  diameter: Float64Array | null;
  codes: Int16Array | null;
  /** Group names, and the indices that have a drawn point (legend order). */
  names: string[];
  used: number[];
  groupLabel: string;
  colorLabel: string;
  /** Half error length per axis per point; NaN = no bar. */
  err: Triple<Float64Array | null>;
  errSkipped: number;
  /** A cap across each end of every drawn error bar (`sc_err_caps`). */
  caps: boolean;
  walls: Triple<boolean>;
  /** The hull the axes span (points and error bar ends). */
  hull: Triple<[number, number]>;
  /** The footnote / caption: what was sampled, left out, or sized by. */
  note: string;
}

const COLS = ["sc_color", "sc_size", "sc_group", "sc_err_x", "sc_err_y", "sc_err_z"] as const;
const WALLS = ["wall_xy", "wall_xz", "wall_yz"] as const;
const fin = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Whether a scatter request asks for any extra. */
export const scatterRequested = (b: MapFigureSpec): boolean => COLS.some((k) => b[k] != null) || WALLS.some((k) => b[k] === true);

/** The wall each shadow lands on: per axis the limit FARTHER from the viewer
 *  (the low limit when the eye is on the positive side), `backFaces`' rule. */
export function wallValues(hull: PointExtras["hull"], elev: number, azim: number): Triple<number> {
  const DEG = Math.PI / 180;
  const e = elev * DEG, a = azim * DEG;
  const eye = [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
  return hull.map((h, k) => (eye[k] > 0 ? h[0] : h[1])) as Triple<number>;
}

/** The end caps of every drawn error bar as 6 numbers per segment (data coordinates),
 *  `calc/figure_map3d_scatter.cap_segments`: a cross of two segments per bar end,
 *  along the two OTHER axes, `CAP_HALF` box units either side. Order: per axis,
 *  low end then high end, per cross axis, per drawn bar. */
export function capSegments(
  pts: readonly [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>], err: PointExtras["err"], hull: PointExtras["hull"],
): number[] {
  const out: number[] = [];
  const half = hull.map((h, k) => (CAP_HALF * (h[1] - h[0])) / BOX[k]);
  err.forEach((e, k) => {
    if (!e) return;
    for (const sign of [-1, 1]) for (let j = 0; j < 3; j++) {
      if (j === k) continue;
      for (let i = 0; i < e.length; i++) {
        if (!Number.isFinite(e[i])) continue;
        const c = [pts[0][i], pts[1][i], pts[2][i]];
        c[k] += sign * e[i];
        const lo = [...c], hi = [...c];
        lo[j] -= half[j];
        hi[j] += half[j];
        out.push(...lo, ...hi);
      }
    }
  });
  return out;
}

/** `calc/figure_map3d.decimate` over a list of indices: evenly spread, first and last kept. */
function decimateIdx(idx: number[]): number[] {
  const n = idx.length;
  const pos = new Set<number>();
  for (let k = 0; k < MAX_POINTS; k++) pos.add(Math.round((k * (n - 1)) / (MAX_POINTS - 1)));
  return [...pos].map((p) => idx[p]);
}

/** Apply the row rules to the finite points `x/y/z` (row `rows[i]` of the
 *  request, or none when a grid gave the cells). Returns the kept indices into
 *  them and the extras, or the refusal; null when no extra was asked for. */
export function planScatter(
  b: MapFigureSpec, n: number, x: ArrayLike<number>, y: ArrayLike<number>, z: ArrayLike<number>, rows: number[] | null,
): { keep: number[]; extras: PointExtras } | { error: string } | null {
  if (!scatterRequested(b)) return null;
  if (COLS.some((k) => b[k] != null) && !rows) return { error: "per-point columns (colour, size, group, error bars) need contour_source='points'" };
  if (b.sc_color != null && b.sc_group != null) return { error: "colour by a column or by groups, not both: send sc_color or sc_group" };
  const cols: Record<string, Col | null> = {};
  for (const k of COLS) {
    const c = (b[k] as Col | null | undefined) ?? null;
    if (c && c.length !== n) return { error: `${k} must have one value per row (${n}), got ${c.length}` };
    cols[k] = c;
  }
  const names = b.sc_group_names ?? [];
  if (cols.sc_group && !(names.length >= 1 && names.length <= MAX_GROUPS)) {
    return { error: `a 3-D scatter takes 1 to ${MAX_GROUPS} groups; this column has ${names.length} (pick a column with fewer distinct values)` };
  }
  const row = (i: number) => (rows ? rows[i] : i);
  const grp = cols.sc_group;
  let keep: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const r = row(i);
    if (!(fin(x[i]) && fin(y[i]) && fin(z[i]))) continue;
    if (cols.sc_color && !fin(cols.sc_color[r])) continue;
    if (cols.sc_size && !fin(cols.sc_size[r])) continue;
    if (grp) {
      const g = grp[r];
      if (!(typeof g === "number" && Number.isInteger(g) && g >= 0 && g < names.length)) continue;
    }
    keep.push(i);
  }
  if (keep.length < 3) return { error: `a 3-D scatter needs at least 3 finite points; found ${keep.length}` };
  const total = keep.length;
  const notes = [b.note ?? ""];
  if (total > MAX_POINTS) {
    keep = decimateIdx(keep);
    notes.push(`Plotting ${keep.length.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} points, evenly sampled.`);
  }
  const pick = (c: Col | null): Float64Array | null => (c ? Float64Array.from(keep, (i) => c[row(i)] as number) : null);
  let errSkipped = 0;
  const err = (["sc_err_x", "sc_err_y", "sc_err_z"] as const).map((k) => {
    const c = cols[k];
    if (!c) return null;
    return Float64Array.from(keep, (i) => {
      const v = c[row(i)];
      if (fin(v) && v >= 0) return v;
      errSkipped++;
      return NaN;
    });
  }) as PointExtras["err"];
  const sz = pick(cols.sc_size);
  let diameter: Float64Array | null = null;
  if (sz) {
    let lo = Infinity, hi = -Infinity;
    for (const v of sz) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    diameter = Float64Array.from(sz, (v) => SIZE_DIAMETER[0] + (SIZE_DIAMETER[1] - SIZE_DIAMETER[0]) * (hi > lo ? (v - lo) / (hi - lo) : 0.5));
  }
  const codes = grp ? Int16Array.from(keep, (i) => grp[row(i)] as number) : null;
  const hull = ([x, y, z] as ArrayLike<number>[]).map((a, k) => {
    const e = err[k];
    let lo = Infinity, hi = -Infinity;
    keep.forEach((i, j) => {
      const half = e && Number.isFinite(e[j]) ? e[j] : 0;
      lo = Math.min(lo, a[i] - half);
      hi = Math.max(hi, a[i] + half);
    });
    return padSpan(lo, hi);
  }) as PointExtras["hull"];
  return {
    keep,
    extras: {
      color: pick(cols.sc_color), diameter, codes, names, used: codes ? [...new Set(codes)].sort((p, q) => p - q) : [],
      groupLabel: b.sc_group_label ?? "", colorLabel: b.sc_color_label ?? "", err, errSkipped, caps: b.sc_err_caps === true,
      walls: [b.wall_xy === true, b.wall_xz === true, b.wall_yz === true], hull, note: notes.filter(Boolean).join(" "),
    },
  };
}
