// The canvas half of the line-polish options (plan item 17; geometry in
// `lineStyleGeometry.ts`, export in `calc/figure_line_style.py`): the stroke of
// a series with a gap to its symbols and / or a double line, and the redraw that
// puts the line in front of the symbols. Part of the lazy marks chunk
// (`marksImpl` re-exports it; `marksLoader.usesMarks` asks for it).
//
// uPlot draws a series' path, then its points, then fires `drawSeries`. So a
// line "behind" the symbols (today's order, the default) is just the path; a
// line "in front" has its stroke left out of the path and painted by the
// `drawSeries` hook below, after the points.

import type uPlot from "uplot";

import { lineStrokes } from "./lineStyleGeometry";
import type { LineStyleSpec } from "./lineStyleSanitize";

/** A built series def that carries line polish (read back by the hook, the live-paint fingerprint). */
export type LineStyledSeries = uPlot.Series & { qzLine?: LineStyleSpec };

const DEFAULT_SYMBOL_PX = 5;

/** The strokes (polylines in device px) of series `sidx` over rows `i0..i1`. */
export function strokesOf(u: uPlot, sidx: number, i0: number, i1: number, spec: LineStyleSpec): [number, number][][] {
  const s = u.series[sidx];
  const xs = u.data[0] as ArrayLike<number | null | undefined>;
  const ys = u.data[sidx] as ArrayLike<number | null | undefined>;
  const scale = s.scale ?? "y";
  const k = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1; // lengths are CSS px / points
  const n = Math.max(0, i1 - i0 + 1);
  const px = new Array<number>(n);
  const py = new Array<number>(n);
  for (let r = 0; r < n; r++) {
    const x = xs[i0 + r];
    const y = ys[i0 + r];
    const ok = x != null && y != null && Number.isFinite(x) && Number.isFinite(y);
    px[r] = ok ? u.valToPos(x, "x", true) : NaN;
    py[r] = ok ? u.valToPos(y, scale, true) : NaN;
  }
  // The rows that carry a symbol: the points config's own filter (every Nth), else every drawn point.
  const pts = s.points;
  let marked: (r: number) => boolean = () => false;
  if (pts && pts.show !== false) {
    const show = typeof pts.show === "function" ? pts.show(u, sidx, i0, i1) : true;
    const filt = pts.filter;
    const keep = typeof filt === "function" ? filt(u, sidx, !!show, null) : filt;
    if (keep) {
      const set = new Set(keep);
      marked = (r) => set.has(i0 + r);
    } else if (show) marked = () => true;
  }
  const size = typeof pts?.size === "number" ? pts.size : DEFAULT_SYMBOL_PX;
  const strokes = lineStrokes(px, py, marked, (size / 2) * k, spec.gap * k, spec.sep * k);
  return strokes.map((piece) => piece.map(([x, y]) => [x, y] as [number, number]));
}

const toPath = (strokes: readonly (readonly (readonly [number, number])[])[]): Path2D => {
  const p = new Path2D();
  for (const piece of strokes) {
    piece.forEach(([x, y], j) => (j === 0 ? p.moveTo(x, y) : p.lineTo(x, y)));
  }
  return p;
};

/** The series' path builder: its stroke is the gapped / doubled line (empty when the line is drawn in
 *  front, by `lineFrontPlugin`); a fill or band still comes from `base`. A series whose x is not
 *  ascending draws every row in acquisition order. */
export function lineStylePaths(
  base: uPlot.Series.PathBuilder | undefined,
  spec: LineStyleSpec,
  ascending: boolean,
): uPlot.Series.PathBuilder {
  return (u, sidx, i0, i1) => {
    const p = base?.(u, sidx, i0, i1) ?? null;
    const last = u.data[0].length - 1;
    const stroke = spec.front ? new Path2D() : toPath(strokesOf(u, sidx, ascending ? i0 : 0, ascending ? i1 : last, spec));
    return { fill: null, clip: null, band: null, ...p, stroke };
  };
}

/** Paints the stroke of every series drawn "in front", over its symbols. */
export function lineFrontPlugin(): uPlot.Plugin {
  return {
    hooks: {
      drawSeries: (u: uPlot, sidx: number) => {
        const s = u.series[sidx] as LineStyledSeries;
        if (!s.qzLine?.front || s.show === false) return;
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        const last = u.data[0].length - 1;
        // 1 is uPlot's Series.Sorted.Ascending: a `const enum`, which cannot be
        // imported as a value here, so compare as a number.
        const sorted = (u.series[0].sorted as number | undefined) === 1;
        const i0 = sorted ? Math.max(0, (u.valToIdx?.(u.scales.x.min ?? 0) ?? 0) - 1) : 0;
        const i1 = sorted ? Math.min(last, (u.valToIdx?.(u.scales.x.max ?? 0) ?? last) + 1) : last;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.lineWidth = (s.width ?? 1) * (window.devicePixelRatio || 1);
        ctx.lineJoin = "round";
        ctx.lineCap = "butt";
        ctx.strokeStyle = typeof s.stroke === "function" ? String(s.stroke(u, sidx)) : String(s.stroke);
        ctx.setLineDash((s.dash ?? []).map((d) => d * (window.devicePixelRatio || 1)));
        ctx.stroke(toPath(strokesOf(u, sidx, i0, i1, s.qzLine)));
        ctx.restore();
      },
    },
  };
}
