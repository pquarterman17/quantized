// A non-monotonic-x line (a hysteresis loop, a swept-back scan, rows in no
// order at all) drawn over its full acquisition order. Moved out of
// lib/uplotSeries.ts into the region-decor STARTUP chunk
// (lib/uplotRegionShades.ts re-exports it) for the eager-bundle budget; the
// eager side is `loopLine` in lib/uplotSeries.ts.
//
// Why the stroke is built here and not by uPlot's linear builder: uPlot
// min/max-decimates only by ascending x, so a loop is stroked with every row
// as a vertex, and canvas raster cost grows with the stroked area. A 100k-row
// file whose consecutive rows jump across the plot (x,y,z columns in no
// particular order) took about 85 s per frame in headless Chromium, twice on
// import: about 3 minutes from drop to first paint (measured 2026-11-16).
// Two rules bound it:
//  1. A vertex at the same device pixel as the one before it is not emitted.
//     uPlot rounds every vertex to a whole device pixel (`series.pxRound`)
//     and canvas prunes zero-length segments before stroking (HTML spec,
//     "trace a path"), so the drawn pixels are unchanged.
//  2. A line that covers its plot area many times over (`SATURATED_COVERAGE`)
//     with vertices spread over most of it (`SPREAD_FRACTION`) is a solid
//     block of the series colour at any width, so it is drawn one device
//     pixel wide: Skia's hairline path, about 20x cheaper per pixel (and per
//     segment). Both conditions are needed. A dense band (a noisy loop
//     retraced many times) also covers its area many times, but it is a
//     band with edges, and a thinner stroke visibly narrows it (measured), so
//     the vertex spread keeps it at its own width.

import type uPlot from "uplot";

/** Stroked area / plot area at or above which a spread-out line is drawn one
 *  device pixel wide. At 16 a random-order stroke leaves about e^-16 of the
 *  area uncovered at its own width and e^-11 at one pixel. */
export const SATURATED_COVERAGE = 16;
/** Fraction of the plot's `SPREAD_CELL`-px cells that must hold a vertex. */
export const SPREAD_FRACTION = 0.5;
/** Side (device px) of a vertex-spread cell. */
export const SPREAD_CELL = 8;

/** What `strokeRows` adds up over a whole series. */
export interface StrokeTally {
  /** Stroked length inside the plot box, device px. */
  len: number;
  /** Cells (`SPREAD_CELL` px square over the plot box) holding a vertex. */
  cells: Uint8Array;
  cols: number;
  touched: number;
}

export function strokeTally(u: uPlot): StrokeTally {
  const cols = Math.max(1, Math.ceil(u.bbox.width / SPREAD_CELL));
  return { len: 0, cells: new Uint8Array(cols * Math.max(1, Math.ceil(u.bbox.height / SPREAD_CELL))), cols, touched: 0 };
}

/** Stroke rows [i0, i1] (all drawable) into `p` as one subpath in device
 *  pixels, skipping a vertex at the same rounded pixel as the last one.
 *  Returns the number of vertices emitted. */
export function strokeRows(u: uPlot, sidx: number, i0: number, i1: number, p: Path2D, t: StrokeTally): number {
  const xs = u.data[0] as ArrayLike<number>;
  const ys = u.data[sidx] as ArrayLike<number>;
  const xKey = u.series[0]?.scale ?? "x";
  const yKey = u.series[sidx]?.scale ?? "y";
  const turned = u.scales[xKey]?.ori === 1; // uPlot's lineToV: x runs down the canvas
  // uPlot sets `pxRound` on every series at init (not in its typings).
  const round = (u.series[sidx] as { pxRound?: (v: number) => number } | undefined)?.pxRound ?? Math.round;
  const { left, top, width, height } = u.bbox;
  const inBox = (x: number, y: number) => x >= left && x <= left + width && y >= top && y <= top + height;
  let pen = false;
  let lx = 0;
  let ly = 0;
  let n = 0;
  for (let i = i0; i <= i1; i++) {
    const a = round(u.valToPos(xs[i]!, xKey, true));
    const b = round(u.valToPos(ys[i]!, yKey, true));
    const cx = turned ? b : a;
    const cy = turned ? a : b;
    // An x a log axis cannot place breaks the line, as a y does (`drawable`).
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
      pen = false;
      continue;
    }
    if (!pen) {
      p.moveTo(cx, cy);
      pen = true;
    } else if (cx !== lx || cy !== ly) {
      p.lineTo(cx, cy);
      // On-screen length only: a zoomed-in view must not count what it clips.
      if (inBox(cx, cy) && inBox(lx, ly)) t.len += Math.hypot(cx - lx, cy - ly);
    } else continue;
    lx = cx;
    ly = cy;
    n++;
    const col = Math.floor((cx - left) / SPREAD_CELL);
    const cell = Math.floor((cy - top) / SPREAD_CELL) * t.cols + col;
    if (col >= 0 && col < t.cols && cell >= 0 && cell < t.cells.length && !t.cells[cell]) {
      t.cells[cell] = 1;
      t.touched++;
    }
  }
  return n;
}

/** Is a line with this tally, `widthDev` device px wide, a solid block of its
 *  colour (rule 2 of the header)? */
export function saturated(t: StrokeTally, widthDev: number, areaDev: number): boolean {
  return widthDev > 1 && t.len * widthDev >= SATURATED_COVERAGE * areaDev && t.touched >= SPREAD_FRACTION * t.cells.length;
}

/** Wrap a path builder so it ignores uPlot's (collapsed) index window and
 *  draws the full acquisition order. With `ownStroke` (the linear builder)
 *  the stroke is built by `strokeRows`; the builder is asked only for the
 *  first run's fill and band, which is all a loop ever used of them.
 *
 *  uPlot min/max-decimates a run of >= 4 points per pixel assuming ascending
 *  x, collapsing a dense descending spectrum to one vertical line: draw in
 *  runs short enough to stay exact, joined end to end. `bbox.width` is device
 *  px rounded to a HALF pixel (x.5 at a 125 %/150 % display), so the run is
 *  floored to a whole row count: a fractional run start reads undefined rows,
 *  uPlot's non-null scan answers -1 and the run sweeps from row 0, decimated.
 *  Gaps: uPlot breaks a line by CLIPPING the x interval a null run spans,
 *  which assumes ascending x — on a loop it cut holes into whatever curve
 *  crossed that interval (an overlay's block rows are all nulls). A loop
 *  breaks the line by not drawing across a null (or a value a log axis cannot
 *  place) and keeps no clip. */
export const fullLine = (b: uPlot.Series.PathBuilder, ownStroke = false): uPlot.Series.PathBuilder =>
  (u, sidx) => {
    const ys = u.data[sidx] as readonly (number | null | undefined)[];
    const last = u.data[0].length - 1;
    const run = Math.max(1, Math.ceil(u.bbox.width * 4) - 1); // whole rows, < 4 per pixel
    const log = (u.scales?.[u.series?.[sidx]?.scale ?? "y"]?.distr as number | undefined) === 3;
    const drawable = (i: number) => { const y = ys[i]; return y != null && Number.isFinite(y) && !(log && y <= 0); };
    const own = ownStroke ? new Path2D() : null;
    const tally = own ? strokeTally(u) : null;
    let out: uPlot.Series.Paths | null = null;
    for (let s = 0; s <= last; s++) {
      if (!drawable(s)) continue;
      let e = s;
      while (e < last && drawable(e + 1)) e++;
      for (let i = s; ; i += run) {
        const i1 = Math.min(e, i + run);
        // Each run is its own subpath, as when the builder stroked it.
        if (own) strokeRows(u, sidx, i, i1, own, tally!);
        const p: uPlot.Series.Paths | null = own && out ? null : b(u, sidx, i, i1);
        if (p && out) (out.stroke as Path2D).addPath(p.stroke as Path2D);
        else if (p) out = { ...p, clip: null };
        if (i + run >= e) break;
      }
      s = e;
    }
    if (!out) return b(u, sidx, 0, last);
    if (own) {
      out.stroke = own;
      const dpr = globalThis.devicePixelRatio || 1;
      // `_width` (CSS px) is what uPlot's drawPath strokes with when a builder sets it.
      if (saturated(tally!, (u.series[sidx]?.width ?? 1) * dpr, u.bbox.width * u.bbox.height)) Object.assign(out, { _width: 1 / dpr });
    }
    return out;
  };
