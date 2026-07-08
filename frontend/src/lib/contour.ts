// Interactive contour layer for the 2-D map (ORIGIN_GAP_PLAN #17 remaining
// half — the matplotlib EXPORT side shipped 2026-07-03 in `calc/figure_map.py`
// `render_map_figure`/`_contour_levels`). Two pure pieces:
//
//   1. `contourLevels` — level-value generation, porting
//      `calc/figure_map.py::_contour_levels`'s semantics exactly (count /
//      explicit list, lin / log spacing, the "log floors a non-positive
//      z-min off z-max" rule) so the interactive layer and the exported
//      figure never disagree on where the lines fall.
//   2. `computeContours` — a thin typed wrapper over `d3-contour` (ISC
//      license; see GAP_PLOTTYPES_PLAN.md item 3's RESOLVED dependency
//      choice — no hand-rolled marching squares) that turns a MapPayload-
//      shaped grid into polygon rings in DATA (axis-value) coordinates, plus
//      `ringToCanvas`, a transform matching the rect/axis-extent math
//      `Stage/mapRender.ts` already uses for peak markers and axis ticks.
//
// d3-contour treats the grid as `nx x ny` unit CELLS with sample `i` centred
// at continuous index `i + 0.5` (its own docstring: "⟨i+0.5, j+0.5⟩
// corresponds to element i+jn"). `indexToData` inverts that back to the
// MapPayload's axis values, assuming a uniform grid — true for every
// MapPayload today (both the backend regrid and the client fallback
// `regridNearest` in `lib/mapdata.ts` build axes via linspace).

import { contours as d3contours } from "d3-contour";

export type Point = [number, number];

/** A closed polygon ring: an ordered list of `[x, y]` points in DATA
 *  (axis-value) coordinates. d3-contour always closes rings (first === last). */
export type ContourRing = Point[];

export interface ContourLine {
  level: number;
  /** One or more disjoint loops at this level (a single level can encircle
   *  several separate peaks/valleys, or none if the level misses the data). */
  rings: ContourRing[];
}

export type LevelScale = "linear" | "log";

/** Contour level values: a count (evenly spaced) or an explicit list, lin or
 *  log spaced. Mirrors `calc/figure_map.py::_contour_levels` field-for-field:
 *  an explicit list is sorted and needs >=2 entries; a count needs >=2 and a
 *  finite `zMax > zMin` range; log spacing needs `zMax > 0` and floors a
 *  non-positive `zMin` at `zMax * 1e-3` (matplotlib's `contourf`/`contour`
 *  can't log-scale through zero). Throws (matching the Python `ValueError`s)
 *  on the same invalid inputs — callers should treat that as "skip the
 *  contour overlay for this frame," not a hard failure. */
export function contourLevels(
  zMin: number,
  zMax: number,
  levels: number | number[],
  scale: LevelScale,
): number[] {
  if (Array.isArray(levels)) {
    const arr = [...levels].sort((a, b) => a - b);
    if (arr.length < 2) throw new Error("levels list needs at least 2 entries");
    return arr;
  }
  const n = Math.trunc(levels);
  if (n < 2) throw new Error("levels count must be >= 2");
  if (!Number.isFinite(zMin) || !Number.isFinite(zMax) || !(zMax > zMin)) {
    throw new Error("map has no finite z-range to contour");
  }
  if (scale === "log") {
    if (zMax <= 0) throw new Error("log level_scale needs a positive z-range");
    const lo = zMin > 0 ? zMin : zMax * 1e-3;
    return logspace(Math.log10(lo), Math.log10(zMax), n);
  }
  if (scale !== "linear") throw new Error("level_scale must be 'linear' or 'log'");
  return linspace(zMin, zMax, n);
}

function linspace(lo: number, hi: number, n: number): number[] {
  if (n <= 1) return [lo];
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = lo + ((hi - lo) * i) / (n - 1);
  return out;
}

function logspace(logLo: number, logHi: number, n: number): number[] {
  return linspace(logLo, logHi, n).map((e) => 10 ** e);
}

/** Continuous cell-index -> data-axis value (the uniform-grid inverse of
 *  d3-contour's `i + 0.5` sample-centre convention). */
function indexToData(idx: number, axis: number[]): number {
  const n = axis.length;
  if (n < 2) return axis[0] ?? 0;
  const step = (axis[n - 1] - axis[0]) / (n - 1);
  return axis[0] + (idx - 0.5) * step;
}

/** Run d3-contour's marching squares over a MapPayload-shaped grid at the
 *  given level values, returning rings in DATA coordinates.
 *
 *  `zGrid` is row-major `[ny][nx]` with `zGrid[j][i]` at
 *  `(xAxis[i], yAxis[j])` — the same layout `lib/mapdata.ts`/`mapRender.ts`
 *  use. No y-flip is applied here (that flip is a heatmap-texel/canvas-image
 *  concern only, done separately in `mapRender.ts`'s `buildHeatmapImage`).
 *  A missing cell (`null`) becomes `NaN`, which d3-contour treats as "below
 *  every threshold" — contours hug the edge of a data gap rather than
 *  crossing it, never throwing on holes in the grid. */
export function computeContours(
  xAxis: number[],
  yAxis: number[],
  zGrid: (number | null)[][],
  levelValues: number[],
): ContourLine[] {
  const nx = xAxis.length;
  const ny = yAxis.length;
  if (nx < 2 || ny < 2 || levelValues.length === 0) return [];
  const flat = new Array<number>(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v = zGrid[j]?.[i];
      flat[i + j * nx] = v == null ? NaN : v;
    }
  }
  const gen = d3contours().size([nx, ny]);
  return levelValues.map((level) => {
    const mp = gen.contour(flat, level);
    const rings: ContourRing[] = [];
    for (const polygon of mp.coordinates) {
      for (const ring of polygon) {
        rings.push(ring.map(([px, py]) => [indexToData(px, xAxis), indexToData(py, yAxis)] as Point));
      }
    }
    return { level, rings };
  });
}

/** Data-coordinate ring -> canvas-pixel ring, using the same rect/axis-extent
 *  transform `mapRender.ts` uses for peak markers and axis ticks
 *  (`sx = rect.x + (v-min)/(max-min) * rect.w`; y is flipped since screen y
 *  runs top-down but data y runs bottom-up). */
export function ringToCanvas(
  ring: ContourRing,
  xAxis: number[],
  yAxis: number[],
  rect: { x: number; y: number; w: number; h: number },
): Point[] {
  const xmin = xAxis[0];
  const xmax = xAxis[xAxis.length - 1];
  const ymin = yAxis[0];
  const ymax = yAxis[yAxis.length - 1];
  const dx = xmax - xmin || 1;
  const dy = ymax - ymin || 1;
  return ring.map(([x, y]) => [rect.x + ((x - xmin) / dx) * rect.w, rect.y + rect.h - ((y - ymin) / dy) * rect.h]);
}
