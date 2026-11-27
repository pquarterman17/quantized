// The 3-D BAR and VECTOR scenes, built from the export's own request like every
// other 3-D scene (`scene3d.ts`). Each rule here mirrors
// `calc/figure_map3d_ext.py` -- the footprint (a fraction of the median step
// between distinct positions), the base, the arrowhead built in BOX coordinates,
// the caps and every refusal -- and `tests/fixtures/wire/plot3d_kinds.json`
// pins the two together. Pure; no import of `scene3d` (it imports this).

import type { MapFigureSpec } from "../../../lib/api/mapFigure";
import { BOX } from "../../../lib/project3d";

/** `calc/figure_map3d_ext.py`'s caps, colour and arrowhead spread. */
export const MAX_BARS = 10_000;
export const MAX_VECTORS = 20_000;
export const DEFAULT_VECTOR_COLOR = "#2a6fdb";
export const HEAD_SPREAD = 0.35;

const HEX = /^#[0-9a-fA-F]{6}$/;
const fin = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const n = (v: number): string => v.toLocaleString("en-US");

export interface BarData {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** Footprint in data units, and the level every bar rises from. */
  dx: number;
  dy: number;
  base: number;
  fixed: string | null;
  /** Data range the axes span (bar edges, base). */
  ext: [[number, number], [number, number], [number, number]];
}

export interface VectorData {
  tails: Float64Array;
  tips: Float64Array;
  head: number;
  color: string;
  /** Rows given, and rows not drawn (non-finite, or no length). */
  rows: number;
  hidden: number;
  ext: [[number, number], [number, number], [number, number]];
}

/** The median of the positive steps between the sorted distinct values (0 for < 2). */
export function medianStep(v: ArrayLike<number>): number {
  const u = [...new Set(Array.from(v))].sort((a, b) => a - b);
  if (u.length < 2) return 0;
  const d = u.slice(1).map((q, i) => q - u[i]).sort((a, b) => a - b);
  const m = d.length >> 1;
  return d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2;
}

/** An axis range as the export pads it: a flat range gets 5% of its value (0.5 at zero). */
export function padSpan(lo: number, hi: number): [number, number] {
  if (hi > lo) return [lo, hi];
  const pad = Math.abs(lo) * 0.05 || 0.5;
  return [lo - pad, hi + pad];
}

const flat = (a: number[]): [number, number] => {
  let lo = Infinity, hi = -Infinity;
  for (const v of a) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
};

/** The bars of a request, or the reason there are none (the route's own refusals). */
export function barData(b: MapFigureSpec): BarData | { error: string } {
  const px: number[] = [], py: number[] = [], pz: number[] = [];
  const xa = b.x_axis ?? [], ya = b.y_axis ?? [];
  if (b.contour_source === "points") {
    const za = b.z_values ?? [];
    if (xa.length !== ya.length || xa.length !== za.length) {
      return { error: `x_axis/y_axis/z_values must have the same length, got ${xa.length}/${ya.length}/${za.length}` };
    }
    xa.forEach((x, i) => {
      if (fin(x) && fin(ya[i]) && fin(za[i])) {
        px.push(x);
        py.push(ya[i]);
        pz.push(za[i]);
      }
    });
  } else {
    const grid = b.z_grid ?? [];
    if (grid.length !== ya.length || grid.some((r) => r.length !== xa.length)) {
      return { error: `z_grid must be (ny, nx) = (${ya.length}, ${xa.length})` };
    }
    grid.forEach((row, j) => row.forEach((v, i) => {
      if (fin(v)) {
        px.push(xa[i]);
        py.push(ya[j]);
        pz.push(v);
      }
    }));
  }
  const fixed = b.bar_color ?? null;
  if (fixed !== null && !HEX.test(fixed)) return { error: `bar_color must be a #rrggbb colour, got '${fixed}'` };
  if (px.length < 1) return { error: "a 3-D bar plot needs at least 1 finite bar" };
  if (px.length > MAX_BARS) return { error: `a 3-D bar plot draws at most ${n(MAX_BARS)} bars; this has ${n(px.length)} (lower the map resolution or crop it)` };
  const base = b.bar_base ?? 0;
  if (!Number.isFinite(base)) return { error: "bar_base must be a finite number" };
  const w = b.bar_width ?? 0.8, d = b.bar_depth ?? 0.8;
  for (const [name, f] of [["bar_width", w], ["bar_depth", d]] as const) {
    if (!(Number.isFinite(f) && f > 0 && f <= 1)) return { error: `${name} must be a number above 0 and at most 1 (a fraction of the spacing)` };
  }
  const sx = medianStep(px), sy = medianStep(py);
  if (!(sx > 0 && sy > 0)) return { error: "3-D bars need at least 2 distinct x positions and 2 distinct y positions to size them" };
  const dx = w * sx, dy = d * sy;
  const [x0, x1] = flat(px), [y0, y1] = flat(py), [z0, z1] = flat(pz);
  return {
    x: Float64Array.from(px), y: Float64Array.from(py), z: Float64Array.from(pz), dx, dy, base, fixed,
    ext: [[x0 - dx / 2, x1 + dx / 2], [y0 - dy / 2, y1 + dy / 2], [Math.min(base, z0), Math.max(base, z1)]],
  };
}

/** The vectors a request draws (tail + delta, or tail to end point, times the
 *  scale), or the reason there are none. */
export function vectorData(b: MapFigureSpec): VectorData | { error: string } {
  const xa = b.x_axis ?? [], ya = b.y_axis ?? [], za = b.z_values ?? [];
  if (b.contour_source !== "points") return { error: "3-D vectors need contour_source='points' (x, y, z columns)" };
  const cols = [b.vec_dx, b.vec_dy, b.vec_dz];
  if (cols.some((c) => c == null)) return { error: "3-D vectors need the vec_dx, vec_dy and vec_dz columns" };
  const rows = xa.length;
  if (ya.length !== rows || za.length !== rows) return { error: `x_axis/y_axis/z_values must have the same length, got ${rows}/${ya.length}/${za.length}` };
  if (cols.some((c) => (c as unknown[]).length !== rows)) return { error: `vec_dx/vec_dy/vec_dz must have one value per row (${rows}), got ${(cols[0] as unknown[]).length}` };
  const color = b.vec_color ?? DEFAULT_VECTOR_COLOR;
  if (!HEX.test(color)) return { error: `vec_color must be a #rrggbb colour, got '${color}'` };
  const form = b.vec_form ?? "delta", scale = b.vec_scale ?? 1, head = b.vec_head ?? 0.2;
  if (form !== "delta" && form !== "end") return { error: "vec_form must be 'delta' or 'end'" };
  if (!(Number.isFinite(scale) && scale > 0)) return { error: "vec_scale must be a positive number" };
  if (!(Number.isFinite(head) && head > 0 && head <= 0.5)) return { error: "vec_head must be a number above 0 and at most 0.5 (a fraction of the length)" };
  const [dxs, dys, dzs] = cols as (number | null)[][];
  const t: number[] = [], e: number[] = [];
  for (let i = 0; i < rows; i++) {
    const tail = [xa[i], ya[i], za[i]], d = [dxs[i], dys[i], dzs[i]];
    if (!tail.every(fin) || !d.every(fin)) continue;
    const delta = d.map((v, k) => (form === "end" ? (v as number) - tail[k] : (v as number)));
    const tip = tail.map((v, k) => v + delta[k] * scale);
    if (Math.hypot(tip[0] - tail[0], tip[1] - tail[1], tip[2] - tail[2]) > 0) {
      t.push(...tail);
      e.push(...tip);
    }
  }
  const live = t.length / 3;
  if (live < 1) return { error: "no 3-D vector has a finite start and a non-zero length" };
  if (live > MAX_VECTORS) return { error: `3-D vectors draw at most ${n(MAX_VECTORS)}; got ${n(live)}` };
  const all = [...t, ...e];
  const axis = (k: number): [number, number] => {
    const [lo, hi] = flat(all.filter((_, i) => i % 3 === k));
    if (hi > lo) return [lo, hi];
    const pad = Math.abs(lo) * 0.05 || 0.5;
    return [lo - pad, hi + pad];
  };
  return { tails: Float64Array.from(t), tips: Float64Array.from(e), head, color, rows, hidden: rows - live, ext: [axis(0), axis(1), axis(2)] };
}

/** Each arrow's five segments in DATA coordinates, 30 numbers per arrow (shaft
 *  tail -> tip, then four barbs from the tip). The head is built in box
 *  coordinates (`lim` onto `BOX`) so it keeps its shape on any axis scale:
 *  `vector_segments` in `calc/figure_map3d_ext.py`. */
export function vectorSegments(
  tails: Float64Array, tips: Float64Array, lim: readonly [number, number][], head: number,
): Float64Array {
  const count = tails.length / 3;
  const out = new Float64Array(count * 30);
  const toBox = (v: number, k: number) => ((v - lim[k][0]) / (lim[k][1] - lim[k][0]) - 0.5) * BOX[k];
  const toData = (b: number, k: number) => lim[k][0] + (b / BOX[k] + 0.5) * (lim[k][1] - lim[k][0]);
  for (let i = 0; i < count; i++) {
    const t0 = [0, 1, 2].map((k) => toBox(tails[3 * i + k], k));
    const t1 = [0, 1, 2].map((k) => toBox(tips[3 * i + k], k));
    const d = t1.map((v, k) => v - t0[k]);
    const len = Math.hypot(d[0], d[1], d[2]);
    const u = d.map((v) => v / (len || 1));
    const ref = Math.abs(u[2]) < 0.95 ? [0, 0, 1] : [1, 0, 0];
    const cross = (a: number[], c: number[]) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
    let p1 = cross(u, ref);
    const pn = Math.hypot(p1[0], p1[1], p1[2]);
    p1 = p1.map((v) => v / pn);
    const p2 = cross(u, p1);
    const back = t1.map((v, k) => v - u[k] * head * len);
    const w = HEAD_SPREAD * head * len;
    const seg = (j: number, a: ArrayLike<number>, c: number[]) => {
      for (let k = 0; k < 3; k++) {
        out[i * 30 + j * 6 + k] = a[k];
        out[i * 30 + j * 6 + 3 + k] = c[k];
      }
    };
    seg(0, [tails[3 * i], tails[3 * i + 1], tails[3 * i + 2]], [tips[3 * i], tips[3 * i + 1], tips[3 * i + 2]]);
    const tip = [tips[3 * i], tips[3 * i + 1], tips[3 * i + 2]];
    [[p1, 1], [p1, -1], [p2, 1], [p2, -1]].forEach(([v, s], j) => {
      const dir = v as number[];
      seg(j + 1, tip, back.map((b0, k) => toData(b0 + (s as number) * dir[k] * w, k)));
    });
  }
  return out;
}
