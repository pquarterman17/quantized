// Cell-value labels describe the MEASURED cells of a map, not the grid it is
// displayed on: a 6 x 6 scan shown at the default 100 x 100 Resolution is still
// 36 cells, each printed once at its centre with its raw value. Pure. The
// export applies the same rules (`calc/cell_labels.py: native_cell_spots`),
// pinned by `tests/fixtures/wire/annotation_measures.json` (`cell_native`).

import { clusterAxis, MAX_LATTICE_AXIS, type AxisClusters } from "./cellLatticeJitter";
import { cellLabelFits, formatCellValue } from "./cellLabels";
import type { CellLabelOptions } from "./cellLabelOptions";

/** The measured lattice: raw values `[ny][nx]` over ascending axes; null = no measurement. */
export interface NativeCellGrid {
  xAxis: number[];
  yAxis: number[];
  values: (number | null)[][];
}

/** The cell-label option as the canvas paints it: the format, plus the measured
 *  cells when the data is a lattice (absent: the displayed grid is labelled). */
export type CellLabelPaint = CellLabelOptions & { native?: NativeCellGrid | null };

export interface CellLabelSpot {
  i: number;
  j: number;
  text: string;
  /** Data coordinates of the label's centre. */
  x: number;
  y: number;
}

/** Part of cell `k` (centred on `axis[k]`, edges halfway to its neighbours) that
 *  lies inside the frame `[lo, hi]`: the end cells are cut in half by the frame,
 *  as the heatmap draws them. */
function cellBounds(axis: readonly number[], k: number, lo: number, hi: number): [number, number] {
  const left = k > 0 ? (axis[k - 1] + axis[k]) / 2 : axis[0];
  const right = k < axis.length - 1 ? (axis[k] + axis[k + 1]) / 2 : axis[axis.length - 1];
  return [Math.max(Math.min(lo, hi), left), Math.min(Math.max(lo, hi), right)];
}

/** One label per finite measured cell, at the centre of the part of it the plot
 *  frame shows, dropped when its text does not fit that part. `frame` is
 *  `[x0, x1, y0, y1]` in data units and `size` the frame's `[w, h]` in the unit of
 *  `font` (pixels here, points in the export). */
export function nativeCellSpots(
  n: NativeCellGrid, frame: readonly [number, number, number, number], size: readonly [number, number],
  opts: CellLabelOptions, font: number,
): CellLabelSpot[] {
  const [x0, x1, y0, y1] = frame;
  const spanX = Math.abs(x1 - x0);
  const spanY = Math.abs(y1 - y0);
  if (n.xAxis.length < 2 || n.yAxis.length < 2 || spanX === 0 || spanY === 0) return [];
  const out: CellLabelSpot[] = [];
  for (let j = 0; j < n.yAxis.length; j++) {
    const [bottom, top] = cellBounds(n.yAxis, j, y0, y1);
    const cellH = (size[1] * (top - bottom)) / spanY;
    for (let i = 0; i < n.xAxis.length; i++) {
      const v = n.values[j]?.[i];
      if (v == null || !Number.isFinite(v)) continue;
      const [left, right] = cellBounds(n.xAxis, i, x0, x1);
      const text = formatCellValue(v, opts.format, opts.precision);
      if (!cellLabelFits((size[0] * (right - left)) / spanX, cellH, text, font)) continue;
      out.push({ i, j, text, x: (left + right) / 2, y: (bottom + top) / 2 });
    }
  }
  return out;
}

/** The distinct values of `col` (ascending), merging those within a part in a
 *  billion of the span; null once there are more than `MAX_LATTICE_AXIS`. */
function distinct(col: readonly number[], tol: number): number[] | null {
  const seen = new Map<number, number>();
  for (const v of col) {
    const key = Math.round(v / tol);
    if (!seen.has(key)) {
      seen.set(key, v);
      if (seen.size > MAX_LATTICE_AXIS) return null;
    }
  }
  return [...seen.values()].sort((a, b) => a - b);
}

/** The measured lattice of a scan from its rows (`keys` = x, y, z columns): the
 *  distinct x and y values, each cell the mean of the rows that share it. Stage
 *  positions that are only NEAR a lattice point (jitter up to about a fifth of
 *  the step) are clustered into one coordinate each (lib/cellLatticeJitter.ts).
 *  Null when the rows are not a lattice (scattered points, a line scan): the
 *  caller then labels the displayed grid. */
export function nativeCellGrid(rows: readonly (readonly number[])[], keys: readonly [number, number, number]): NativeCellGrid | null {
  const [kx, ky, kz] = keys;
  const pts = rows.filter((r) => Number.isFinite(r[kx]) && Number.isFinite(r[ky]) && Number.isFinite(r[kz]));
  if (pts.length < 4) return null;
  const spans = [kx, ky].map((k) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of pts) {
      lo = Math.min(lo, r[k]);
      hi = Math.max(hi, r[k]);
    }
    return hi - lo || 1;
  });
  // A lattice has about as many cells as rows; scattered points have ~rows squared.
  const isLattice = (xs: readonly unknown[] | null, ys: readonly unknown[] | null): boolean =>
    !!xs && !!ys && xs.length >= 2 && ys.length >= 2 && xs.length * ys.length <= 2 * pts.length;
  // Exact positions first (unchanged); only a scan that is not an exact lattice is tried with jitter.
  const exact = [kx, ky].map((k, a) => distinct(pts.map((r) => r[k]), spans[a] * 1e-9));
  let axes: AxisClusters[];
  if (isLattice(exact[0], exact[1])) {
    axes = exact.map((axis, a) => ({ axis: axis!, index: (v: number) => nearest(axis!, v, spans[a] * 1e-9) }));
  } else {
    const jit = [kx, ky].map((k, a) => clusterAxis(pts.map((r) => r[k]), spans[a]));
    if (!jit[0] || !jit[1] || !isLattice(jit[0].axis, jit[1].axis)) return null;
    axes = [jit[0], jit[1]];
  }
  const [xs, ys] = [axes[0].axis, axes[1].axis];
  const sum = ys.map(() => new Array<number>(xs.length).fill(0));
  const cnt = ys.map(() => new Array<number>(xs.length).fill(0));
  for (const r of pts) {
    const i = axes[0].index(r[kx]);
    const j = axes[1].index(r[ky]);
    sum[j][i] += r[kz];
    cnt[j][i] += 1;
  }
  return { xAxis: xs, yAxis: ys, values: sum.map((row, j) => row.map((s, i) => (cnt[j][i] ? s / cnt[j][i] : null))) };
}

/** Index of the axis value nearest `v` from below, within `tol`. */
function nearest(axis: number[], v: number, tol: number): number {
  let lo = 0;
  let hi = axis.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (axis[mid] < v - tol) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
