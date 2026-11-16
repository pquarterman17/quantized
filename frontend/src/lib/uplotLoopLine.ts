// The stroke of a non-monotonic-x line (a hysteresis loop, a swept-back scan,
// rows in no order at all), drawn over its full acquisition order. The run
// and gap tiling stays eager in lib/uplotSeries.ts (`fullLine`); this half
// rides the region-decor STARTUP chunk (lib/uplotRegionShades.ts re-exports
// it) for the eager-bundle budget. Until it lands, or if it never does, the
// eager tiling strokes each run with uPlot's own builder, as it always did,
// and the viewport rebuilds once it lands (Stage/useLazyPlotParts).
//
// Why the stroke is built here: uPlot min/max-decimates only by ascending x,
// so a loop is stroked with every row as a vertex, and canvas raster cost
// grows with the stroked area. A 100k-row file whose consecutive rows jump
// across the plot (x,y,z columns in no particular order) took about 85 s per
// frame in headless Chromium, twice on import: about 3 minutes from drop to
// first paint (measured 2026-11-16). Two rules bound it:
//  1. A vertex at the same device pixel as the one before it is not emitted.
//     uPlot rounds every vertex to a whole device pixel (`series.pxRound`)
//     and canvas prunes zero-length segments before stroking (HTML spec,
//     "trace a path"), so the drawn pixels are unchanged.
//  2. A line drawn one device pixel wide instead (Skia's hairline path, about
//     20x cheaper per pixel and per segment) when nearly every
//     (`BURIED_FRACTION`) `SPREAD_CELL`-px cell it touches is itself buried:
//     its stroke in that cell covers the cell `SATURATED_COVERAGE` times
//     over. Those cells are a solid block of the series colour at either
//     width; the few that are not (the corners of an even spread) thin a
//     little. A cloud that is dense
//     in the middle and sparse at its edges (a Gaussian, a random walk), a
//     band with edges (a noisy loop retraced many times) and an ordinary loop
//     all have many touched cells that are not buried, so they keep their
//     width: a thinner stroke visibly thinned each of them (measured).

import type uPlot from "uplot";

/** Stroked area / cell area at or above which a cell counts as buried. At 16
 *  a random-order stroke leaves about e^-16 of the cell uncovered at its own
 *  width and e^-11 at one pixel. */
export const SATURATED_COVERAGE = 16;
/** Fraction of the touched cells that must be buried for the 1-px stroke.
 *  Random chords cover the plot's edges and corners less than its middle, so
 *  an even 100k-row spread buries about 93% of its cells; a Gaussian cloud or
 *  an OU walk buries 33-54% at 100k-1M rows (measured). At 0.9 the even spread
 *  still thins at its corners: 3,013 of 374,269 inked pixels changed by more
 *  than 32/255 (headless Chromium, 669 x 593 px), against 37,850 for a
 *  Gaussian cloud, which this rule keeps at its own width. */
export const BURIED_FRACTION = 0.9;
/** Side (device px) of a coverage cell. */
export const SPREAD_CELL = 8;

/** One series' stroke under construction and its stroked length per cell. */
export interface LoopInk {
  path: Path2D;
  /** Stroked length (device px) inside each `SPREAD_CELL` cell of the plot box. */
  cells: Float32Array;
  cols: number;
}

export function loopInk(u: uPlot): LoopInk {
  const cols = Math.max(1, Math.ceil(u.bbox.width / SPREAD_CELL));
  const rows = Math.max(1, Math.ceil(u.bbox.height / SPREAD_CELL));
  return { path: new Path2D(), cells: new Float32Array(cols * rows), cols };
}

/** Add segment (x0,y0)-(x1,y1)'s length to the cells it crosses, sampled
 *  every half cell. Only the part inside the plot box counts. */
function addLength(u: uPlot, ink: LoopInk, x0: number, y0: number, x1: number, y1: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(len / (SPREAD_CELL / 2)));
  const { left, top, width, height } = u.bbox;
  for (let k = 0; k < n; k++) {
    const x = x0 + ((k + 0.5) / n) * (x1 - x0) - left;
    const y = y0 + ((k + 0.5) / n) * (y1 - y0) - top;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    ink.cells[Math.floor(y / SPREAD_CELL) * ink.cols + Math.floor(x / SPREAD_CELL)]! += len / n;
  }
}

/** Stroke rows [i0, i1] (all with a drawable y) into `ink.path` as one
 *  subpath in device pixels, in uPlot's own order (backwards on a reversed or
 *  turned x, so a dash pattern keeps its phase), skipping a vertex at the
 *  same rounded pixel as the last one. Returns the vertices emitted. */
export function strokeRows(u: uPlot, sidx: number, i0: number, i1: number, ink: LoopInk): number {
  const xs = u.data[0] as ArrayLike<number>;
  const ys = u.data[sidx] as ArrayLike<number>;
  const xKey = u.series[0]?.scale ?? "x";
  const yKey = u.series[sidx]?.scale ?? "y";
  const sx = u.scales[xKey];
  const turned = sx?.ori === 1; // uPlot's lineToV: x runs down the canvas
  const dir = (sx?.dir ?? 1) * (turned ? -1 : 1); // uPlot linear's iteration order
  // uPlot sets `pxRound` on every series at init (not in its typings).
  const round = (u.series[sidx] as { pxRound?: (v: number) => number } | undefined)?.pxRound ?? Math.round;
  const p = ink.path;
  let pen = false;
  let lx = 0;
  let ly = 0;
  let n = 0;
  for (let i = dir === 1 ? i0 : i1; i >= i0 && i <= i1; i += dir) {
    const a = round(u.valToPos(xs[i]!, xKey, true));
    const b = round(u.valToPos(ys[i]!, yKey, true));
    const cx = turned ? b : a;
    const cy = turned ? a : b;
    // A vertex the axis cannot place (a log x at x <= 0): canvas ignores
    // uPlot's lineTo(NaN), joining its neighbours, and so does this.
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    if (!pen) {
      p.moveTo(cx, cy);
      pen = true;
    } else if (cx !== lx || cy !== ly) {
      p.lineTo(cx, cy);
      addLength(u, ink, lx, ly, cx, cy);
    } else continue;
    lx = cx;
    ly = cy;
    n++;
  }
  return n;
}

/** Is nearly every cell this ink touches buried at `widthDev` device px (rule
 *  2 of the header)? */
export function buried(ink: LoopInk, widthDev: number): boolean {
  if (widthDev <= 1) return false;
  const full = (SATURATED_COVERAGE * SPREAD_CELL * SPREAD_CELL) / widthDev;
  let touched = 0;
  let deep = 0;
  for (const len of ink.cells) {
    if (len <= 0) continue;
    touched++;
    if (len >= full) deep++;
  }
  return touched > 0 && deep >= BURIED_FRACTION * touched;
}

/** The finished paths for a loop whose runs went through `strokeRows`: the
 *  first run's fill and band from the builder, this stroke, and the 1-px
 *  width when the ink is buried. `_width` (CSS px) is what uPlot's drawPath
 *  strokes with when a builder sets it; uPlot multiplies it by its pixel
 *  ratio, which is `devicePixelRatio`. */
export function finishLoop(out: uPlot.Series.Paths, ink: LoopInk, u: uPlot, sidx: number): uPlot.Series.Paths {
  out.stroke = ink.path;
  const dpr = globalThis.devicePixelRatio || 1;
  if (buried(ink, (u.series[sidx]?.width ?? 1) * dpr)) Object.assign(out, { _width: 1 / dpr });
  return out;
}
