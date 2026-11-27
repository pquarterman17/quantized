// The options of the 3-D BAR and VECTOR kinds, and the request fields they make.
//
// They are stored on the 3-D view as plain values (`Map3dView.ext`, eager, so
// kept tiny) and READ here, clamped and defaulted, where they are used: a
// hand-edited `.dwk` cannot send a request the route refuses for range. What
// is not a number in range is refused with a reason by the scene builder and the
// route alike (`Map3D/sceneExt3d.ts`, `calc/figure_map3d_ext.py`). Lazy chunk only.

import type { MapFigureSpec } from "../../lib/api/mapFigure";
import type { Map3dView } from "../../lib/mapView3d";
import type { DataStruct } from "../../lib/types";
import { barColourBody } from "./map3dBarColour";
import { scatterBody } from "./map3dScatter";
import { vecColourFields } from "./map3dVecColour";

type Ext = NonNullable<Map3dView["ext"]>;

const num = (v: unknown, d: number, lo: number, hi: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const hex = (v: unknown): string | null => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null);
const col = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

export interface ExtOptions {
  /** Bar footprint, as fractions of the position spacing. */
  barWidth: number;
  barDepth: number;
  /** Fixed bar colour; null = by height. */
  barColor: string | null;
  /** Bar width / depth in DATA units (`barAbs`), instead of fractions of the spacing; null = not typed yet. */
  barAbs: boolean;
  barAW: number | null;
  barAD: number | null;
  /** Grouped bars: the categories of a position stand side by side. */
  barSide: boolean;
  /** The dX / dY / dZ (or end x / y / z) columns, null = not picked. */
  vec: [number | null, number | null, number | null];
  vecEnd: boolean;
  vecScale: number;
  vecHead: number;
  vecColor: string | null;
  /** Colour each vector by its length (a colour bar), instead of one colour. */
  vecLen: boolean;
}

export function readExt(e: Map3dView["ext"]): ExtOptions {
  const x: Ext = e ?? {};
  return {
    barWidth: num(x.barW, 0.8, 0.05, 1),
    barDepth: num(x.barD, 0.8, 0.05, 1),
    barColor: hex(x.barColor),
    barAbs: x.barAbs === true,
    barAW: typeof x.barAW === "number" ? x.barAW : null,
    barAD: typeof x.barAD === "number" ? x.barAD : null,
    barSide: x.barSide === true,
    vec: [col(x.vecDx), col(x.vecDy), col(x.vecDz)],
    vecEnd: x.vecEnd === true,
    vecScale: num(x.vecScale, 1, 1e-6, 1e6),
    vecHead: num(x.vecHead, 0.2, 0.05, 0.5),
    vecColor: hex(x.vecColor),
    vecLen: x.vecLen === true,
  };
}

export interface ExtSource {
  data: DataStruct;
  keys: readonly [number, number, number];
}

/** The request fields of a bar / vector view; `sent` is the body's own z (grid or
 *  rows) so a log scale can put the bars' base under the lowest bar. Vectors
 *  replace the body's points with the finite rows of the six columns. */
export function extBody(v3: Map3dView, sent: Pick<MapFigureSpec, "z_grid" | "z_values">, src: ExtSource | undefined, logZ: boolean): Partial<MapFigureSpec> {
  const o = readExt(v3.ext);
  if (v3.kind === "bars3d") {
    // Coloured from a column: the bars are the source rows, so the base follows THEIR z.
    const col = barColourBody(v3, logZ, src);
    const rows = col ?? sent;
    let base: number | undefined;
    if (logZ) {
      const z = [...(rows.z_values ?? []), ...(col ? [] : sent.z_grid ?? []).flat()].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      // log10 values: a base of 0 would be the value 1; sit one decade-floor under the lowest bar.
      if (z.length) base = Math.floor(z.reduce((a, b) => Math.min(a, b)));
    }
    return {
      ...col,
      bar_width: o.barWidth, bar_depth: o.barDepth,
      ...(base !== undefined ? { bar_base: base } : {}),
      ...(o.barColor ? { bar_color: o.barColor } : {}),
      ...(o.barSide ? { bar_grouped: true } : {}),
      // Absolute sizes: sent as typed (a non-positive one is refused with its reason, never clamped).
      ...(o.barAbs ? { bar_abs: true, ...(o.barAW !== null ? { bar_abs_w: o.barAW } : {}), ...(o.barAD !== null ? { bar_abs_d: o.barAD } : {}) } : {}),
    };
  }
  if (v3.kind === "scatter3d") return scatterBody(v3, logZ, src, {});
  if (v3.kind !== "vectors3d") return {};
  const common = { vec_form: o.vecEnd ? ("end" as const) : ("delta" as const), vec_scale: o.vecScale, vec_head: o.vecHead, ...(o.vecColor ? { vec_color: o.vecColor } : {}), ...(o.vecLen ? { vec_by_length: true } : {}) };
  if (!src || o.vec.some((c) => c === null)) return { x_axis: [], y_axis: [], z_values: [], contour_source: "points", ...common };
  const picks = [...src.keys, ...o.vec] as number[];
  const idx = src.data.values.flatMap((r, i) => (picks.every((k) => Number.isFinite(r[k])) ? [i] : []));
  const rows = idx.map((i) => (src.data.values[i]));
  const at = (k: number) => rows.map((r) => r[picks[k]]);
  return {
    x_axis: at(0), y_axis: at(1), z_values: at(2), contour_source: "points",
    vec_dx: at(3), vec_dy: at(4), vec_dz: at(5), ...common, ...vecColourFields(v3.ext, src, idx),
  };
}
