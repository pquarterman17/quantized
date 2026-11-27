// What the interactive 3-D view draws, built from the EXPORT'S OWN REQUEST
// (`/api/export/map-figure` body: `mapFigureBody` for the Map stage,
// `curveWaterfallBody` for the waterfall workshop). The canvas therefore shows
// exactly the data, sampling, waterfall rows, colour range and labels the
// static figure renders -- the same rules as `calc/figure_map.py::_draw`,
// mirrored here (grid scatter = its finite cells in row order, sampled to the
// cap; waterfall = rows with 2+ finite points, evenly stepped to `max_lines`,
// coloured by row position; curves = one polyline per curve at its depth). Pure.

import type { MapFigureSpec } from "../../../lib/api/mapFigure";
import type { ColormapName } from "../../../lib/colormap";
import { MAP3D_MAX_POINTS, sampleEvenly } from "../map3dRequest";
import { planBarColour, type BarColour } from "./barColour3d";
import { planScatter, type PointExtras } from "./scatterExtras3d";
import { barData, padSpan, vectorData, vectorSegments } from "./sceneExt3d";

export interface Axis3 {
  lo: number;
  hi: number;
  label: string;
}

interface Base {
  x: Axis3;
  y: Axis3;
  z: Axis3;
  /** Colour range, in z's units (log10 under a log colour scale). */
  clim: [number, number];
  cmap: ColormapName;
  /** z holds log10 of the quantity: ticks read as the value (1e-3, 100). */
  log10: boolean;
  title: string;
}

export interface SurfaceScene extends Base {
  kind: "surface";
  xs: Float64Array;
  ys: Float64Array;
  /** Row-major ny x nx heights; NaN = a gap (no quad touching it is drawn). */
  zs: Float64Array;
}

export interface PointScene extends Base {
  kind: "points";
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
  drop: boolean;
  /** Colour column / size / groups / error bars / wall shadows (`scatterExtras3d.ts`); absent = the plain scatter. */
  extras?: PointExtras;
}

export interface Line3 {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** Position along the colormap, 0..1 (row / curve order). */
  t: number;
}

export interface LineScene extends Base {
  kind: "lines";
  lines: Line3[];
}

/** Bars: one box per (x, y) anchor from `base` to z, `dx` x `dy` wide (data units). */
export interface BarScene extends Base {
  kind: "bars";
  bx: Float64Array;
  by: Float64Array;
  bz: Float64Array;
  dx: number;
  dy: number;
  base: number;
  /** A fixed #rrggbb colour, or null = coloured by height (with a colour bar). */
  fixed: string | null;
  /** A clamped-size sentence (`barLayout3d`), "" when none: shown in the caption, as the export's footnote. */
  note: string;
  /** Colour from a column (`barColour3d.ts`): a number column sets `clim` and the colour bar, categories a legend. */
  colour?: BarColour;
}

/** Vectors: `segs` holds 5 segments (shaft + 4 head barbs, data coordinates) per arrow. */
export interface VectorScene extends Base {
  kind: "vectors";
  tails: Float64Array;
  tips: Float64Array;
  segs: Float64Array;
  color: string;
  rows: number;
  hidden: number;
  /** Per arrow, its length in data units when coloured by length (`clim` is their extent); else null. */
  lengths: Float64Array | null;
  /** Colour from a column (`vectorColour3d.ts`): `clim` is a number column's own extent; categories get a legend. Else null. */
  colour: BarColour | null;
}

/** The title of a colour bar that is NOT the z axis (a column's, or the vectors' length), else null. */
export function ownColorbarTitle(s: Scene3d): string | null {
  if (s.kind === "points") return s.extras?.color ? s.extras.colorLabel : null;
  if (s.kind === "bars") return s.colour?.values ? s.colour.colorLabel : null;
  if (s.kind === "vectors" && s.colour) return s.colour.values ? s.colour.colorLabel : null;
  return s.kind === "vectors" && s.lengths ? VECTOR_LENGTH_LABEL : null;
}

export type Scene3d = SurfaceScene | PointScene | LineScene | BarScene | VectorScene;

/** Whether the scene has a colour bar (a waterfall, vectors and fixed-colour bars have none). */
export const hasColorbar = (s: Scene3d): boolean =>
  s.kind === "surface" || (s.kind === "points" && !s.extras?.codes) || (s.kind === "bars" && s.fixed === null && !s.colour?.codes) || (s.kind === "vectors" && (!!s.lengths || !!s.colour?.values));

/** `calc/figure_map3d_colour.py` LENGTH_LABEL. */
export const VECTOR_LENGTH_LABEL = "Vector length";

const FROM_MPL: Record<string, ColormapName> = { viridis: "viridis", magma: "magma", gray: "gray", RdBu_r: "rdbu" };

const fin = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

function extent(arrays: ArrayLike<number>[]): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const a of arrays) for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(hi >= lo)) return [0, 1];
  if (hi === lo) {
    const pad = Math.abs(lo) * 0.05 || 0.5;
    return [lo - pad, hi + pad];
  }
  return [lo, hi];
}

function axis(arrays: ArrayLike<number>[], label: string): Axis3 {
  const [lo, hi] = extent(arrays);
  return { lo, hi, label };
}

function base(b: MapFigureSpec, xs: ArrayLike<number>[], ys: ArrayLike<number>[], zs: ArrayLike<number>[]): Base {
  const z = axis(zs, b.z_label ?? "");
  const lim = b.z_limits;
  return {
    x: axis(xs, b.x_label ?? ""),
    y: axis(ys, b.y_label ?? ""),
    z,
    clim: lim && lim.length === 2 && lim[0] < lim[1] ? [lim[0], lim[1]] : [z.lo, z.hi],
    cmap: FROM_MPL[b.cmap ?? "viridis"] ?? "viridis",
    log10: b.colorbar_log10 === true,
    title: b.title ?? "",
  };
}

function points(
  b: MapFigureSpec, x: number[], y: number[], z: number[], rows: number[] | null = null, n = x.length,
): PointScene | { error: string } {
  const plan = planScatter(b, n, x, y, z, rows);
  if (plan && "error" in plan) return plan;
  if (!plan && x.length < 3) return { error: `a 3-D scatter needs at least 3 finite points; found ${x.length}` };
  let idx = plan ? plan.keep : x.map((_, i) => i);
  if (idx.length > MAP3D_MAX_POINTS) idx = sampleEvenly(idx, MAP3D_MAX_POINTS);
  const px = Float64Array.from(idx, (i) => x[i]);
  const py = Float64Array.from(idx, (i) => y[i]);
  const pz = Float64Array.from(idx, (i) => z[i]);
  const sc = base(b, [px], [py], [pz]);
  if (!plan) return { kind: "points", ...sc, px, py, pz, drop: b.drop_lines === true };
  // Extras: the axes span the hull (error bar ends); the colour range is the
  // picked column's own extent, else the map's colour limits, else z's extent.
  const ex = plan.extras;
  const ax = (k: number, a: Axis3): Axis3 => ({ ...a, lo: ex.hull[k][0], hi: ex.hull[k][1] });
  const zr = ex.color ?? pz;
  const lim = b.z_limits;
  const clim: [number, number] = ex.color || !(lim && lim.length === 2 && lim[0] < lim[1]) ? extent([zr]) : [lim![0], lim![1]];
  const out: PointScene = {
    kind: "points", ...sc, x: ax(0, sc.x), y: ax(1, sc.y), z: ax(2, sc.z), clim, px, py, pz, drop: b.drop_lines === true, extras: ex,
  };
  return out;
}

/** `calc/figure_map3d.py`'s limits: a value the axes cannot span, and the
 *  separate-curve waterfall's total point cap. */
const MAX_ABS = 1e100;
export const MAX_CURVE_POINTS = 200_000;

function tooLarge(s: Scene3d): boolean {
  return [s.x, s.y, s.z].some((a) => Math.abs(a.lo) > MAX_ABS || Math.abs(a.hi) > MAX_ABS);
}

/** The scene for a 3-D export request, or the reason it cannot be drawn (the
 *  same refusals the route gives, so the screen never shows a figure the
 *  export would refuse). */
export function sceneFromBody(b: MapFigureSpec): Scene3d | { error: string } {
  const s = buildScene(b);
  if (!("error" in s) && tooLarge(s)) return { error: "3-D values beyond +/-1e100 cannot be drawn on an axis" };
  return s;
}

const span = (r: [number, number]) => Float64Array.of(r[0], r[1]);

function extScene(b: MapFigureSpec): Scene3d | { error: string } {
  if (b.kind === "bars3d") {
    const plan = planBarColour(b);
    if (plan && "error" in plan) return plan;
    const d = barData(b, plan?.rows, plan?.colour.codes);
    if ("error" in d) return d;
    const sc = base(b, [span(d.ext[0])], [span(d.ext[1])], [span(d.ext[2])]);
    // The colour range is the bars' own heights (not the base), as the export's norm.
    const [lo, hi] = [Math.min(...d.z), Math.max(...d.z)];
    const pad = Math.abs(lo) * 0.05 || 0.5;
    const lim = b.z_limits;
    const clim: [number, number] = lim && lim.length === 2 && lim[0] < lim[1] ? [lim[0], lim[1]] : hi > lo ? [lo, hi] : [lo - pad, hi + pad];
    const colour = plan?.colour;
    // A number column colours over its own extent (never the map's z limits).
    const own: [number, number] | null = colour?.values ? padSpan(Math.min(...colour.values), Math.max(...colour.values)) : null;
    return { kind: "bars", ...sc, clim: own ?? clim, bx: d.x, by: d.y, bz: d.z, dx: d.dx, dy: d.dy, base: d.base, fixed: d.fixed, note: d.note, ...(colour ? { colour } : {}) };
  }
  const d = vectorData(b);
  if ("error" in d) return d;
  const sc = base(b, [span(d.ext[0])], [span(d.ext[1])], [span(d.ext[2])]);
  const segs = vectorSegments(d.tails, d.tips, d.ext, d.head);
  // Coloured by length: the colour range is the drawn arrows' own extent.
  let clim = sc.clim;
  const own = d.colour?.values ?? d.lengths;
  if (own) {
    let lo = Infinity, hi = -Infinity;
    for (const v of own) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    clim = padSpan(lo, hi);
  }
  return { kind: "vectors", ...sc, clim, tails: d.tails, tips: d.tips, segs, color: d.color, rows: d.rows, hidden: d.hidden, lengths: d.lengths, colour: d.colour };
}

function buildScene(b: MapFigureSpec): Scene3d | { error: string } {
  const kind = b.kind ?? "";
  if (kind === "bars3d" || kind === "vectors3d") return extScene(b);
  if (b.contour_source === "curves") {
    const curves = (b.curves ?? []).map((c) => {
      const keep = c.x.map((_, i) => i).filter((i) => fin(c.x[i]) && fin(c.z[i]));
      return { x: keep.map((i) => c.x[i]), z: keep.map((i) => c.z[i]), depth: c.depth };
    }).filter((c) => c.x.length >= 2);
    if (curves.length < 2) return { error: `a 3-D waterfall needs at least 2 curves with 2 or more points; found ${curves.length}` };
    const total = curves.reduce((n, c) => n + c.x.length, 0);
    if (total > MAX_CURVE_POINTS) {
      return { error: `a 3-D waterfall draws at most ${MAX_CURVE_POINTS.toLocaleString("en-US")} points; got ${total.toLocaleString("en-US")}` };
    }
    const lines = curves.map((c, j) => ({
      x: Float64Array.from(c.x), y: new Float64Array(c.x.length).fill(c.depth), z: Float64Array.from(c.z), t: j / Math.max(1, curves.length - 1),
    }));
    return { kind: "lines", ...base(b, lines.map((l) => l.x), lines.map((l) => l.y), lines.map((l) => l.z)), lines };
  }
  const xa = b.x_axis ?? [];
  const ya = b.y_axis ?? [];
  if (b.contour_source === "points") {
    const keep = xa.map((_, i) => i).filter((i) => fin(xa[i]) && fin(ya[i]) && fin(b.z_values?.[i]));
    return points(b, keep.map((i) => xa[i]), keep.map((i) => ya[i]), keep.map((i) => b.z_values?.[i] as number), keep, xa.length);
  }
  const grid = b.z_grid ?? [];
  const nx = xa.length, ny = ya.length;
  if (nx < 2 || ny < 2 || grid.length !== ny) return { error: `a 3-D view needs at least a 2x2 grid, got (${ny}, ${nx})` };
  if (kind === "scatter3d") {
    const x: number[] = [], y: number[] = [], z: number[] = [];
    grid.forEach((row, j) => row.forEach((v, i) => {
      if (fin(v)) {
        x.push(xa[i]);
        y.push(ya[j]);
        z.push(v);
      }
    }));
    return points(b, x, y, z);
  }
  if (kind === "waterfall") {
    let rows = grid.map((row, j) => (row.filter(fin).length >= 2 ? j : -1)).filter((j) => j >= 0);
    if (rows.length < 2) return { error: `a 3-D waterfall needs at least 2 curves with 2 or more points; found ${rows.length}` };
    const max = b.max_lines ?? 0;
    if (max > 0 && max < rows.length) rows = sampleEvenly(rows, Math.max(max, 2));
    const lines = rows.map((j) => {
      const keep = grid[j].map((_, i) => i).filter((i) => fin(grid[j][i]));
      return {
        x: Float64Array.from(keep, (i) => xa[i]), y: new Float64Array(keep.length).fill(ya[j]),
        z: Float64Array.from(keep, (i) => grid[j][i] as number), t: j / Math.max(1, ny - 1),
      };
    });
    // The axes span the plotted points (matplotlib autoscales to them), not the grid.
    return { kind: "lines", ...base(b, lines.map((l) => l.x), lines.map((l) => l.y), lines.map((l) => l.z)), lines };
  }
  const zs = new Float64Array(nx * ny);
  let n = 0;
  grid.forEach((row, j) => row.forEach((v, i) => {
    zs[j * nx + i] = fin(v) ? v : NaN;
    if (fin(v)) n++;
  }));
  if (n < 4) return { error: `a 3-D surface needs at least 4 finite grid cells; found ${n}` };
  const ok = (k: number) => Number.isFinite(zs[k]);
  let quad = false;
  for (let j = 0; j < ny - 1 && !quad; j++) for (let i = 0; i < nx - 1 && !quad; i++) {
    const k = j * nx + i;
    quad = ok(k) && ok(k + 1) && ok(k + nx) && ok(k + nx + 1);
  }
  if (!quad) return { error: "a 3-D surface needs at least one grid cell with four finite corners" };
  const xs = Float64Array.from(xa), ys = Float64Array.from(ya);
  return { kind: "surface", ...base(b, [xs], [ys], [zs.filter(Number.isFinite)]), xs, ys, zs };
}
