// Color-mapped scatter (MAIN #14): pair a plotted y-channel with a THIRD
// channel whose values pick each point's colour. The z values are just
// another channel of the same dataset, read client-side and aligned by row —
// no backend involvement for the interactive plot (the export path resolves
// the same channel index server-side, see `calc/plotting.resolve_style_channels`).
// This module is the pure, testable core; the canvas drawing lives in
// `uplotOverlays.colorScatterPlugin` — the same split `lib/errorbars.ts` uses
// for error-bar magnitudes. P1.4's gradient Color-by (lib/plotEncoding.ts)
// builds the same specs, so the Stage, the Graph Builder preview and the
// export colour a point through ONE rule: `colorScatterFill`.

import { colormap, normalize, type ColormapName } from "./colormap";
import { FILLED_SHAPES, markerSubpaths } from "./markers";
import type { DataStruct, MarkerShape, SeriesStyle } from "./types";

export interface ColorScatterSpec {
  /** Source channel index (for the legend/colorbar label). */
  channel: number;
  z: (number | null)[];
  colormap: ColormapName;
  lo: number;
  hi: number;
  /** P1.4: the colour-scale label (default: the channel's label). */
  label?: string;
  /** P1.4: the point glyph (default: a circle) — a Symbol-by level's. */
  shape?: MarkerShape;
}

/** The fill of row `i`'s point: its z value normalized over [lo, hi] (linear;
 *  a degenerate range reads 0) through the colormap, as `rgb(r, g, b)` — or
 *  null for a non-finite z (the point is not drawn). The backend port is
 *  `calc.figure_colorscatter.gradient_colors`. */
export function colorScatterFill(spec: ColorScatterSpec, i: number): string | null {
  const t = normalize(spec.z[i] ?? NaN, spec.lo, spec.hi, false);
  if (t == null) return null;
  const [r, g, b] = colormap(spec.colormap, t);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Paint one colour-mapped point at (px, py): a circle of radius `r`, or a
 *  `markerSubpaths` glyph (closed glyphs fill, open ones stroke). */
export function paintColorPoint(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  r: number,
  fill: string,
  shape: MarkerShape = "circle",
): void {
  const closed = shape === "circle" || FILLED_SHAPES.has(shape);
  ctx.fillStyle = ctx.strokeStyle = fill;
  ctx.beginPath();
  if (shape === "circle") ctx.arc(px, py, r, 0, Math.PI * 2);
  for (const sub of markerSubpaths(shape, px, py, r + 1)) {
    sub.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (closed) ctx.closePath();
  }
  if (closed) ctx.fill();
  else ctx.stroke();
}

/** Per-display-column colour-by-value specs, keyed by the uPlot data-column
 *  index (1-based: column 0 is x, column p+1 is the p-th plotted series) —
 *  the same keying convention `buildErrorColumns` uses. `lo`/`hi` are the
 *  colour-mapped channel's full finite range (over every row, not just the
 *  currently-plotted ones), so the colour scale — and the colorbar chip's
 *  min/max labels — stay stable across zoom/pan. A channel with no finite
 *  values at all is skipped (nothing to colour). */
export function buildColorByColumns(
  ds: DataStruct,
  plotted: readonly number[],
  seriesStyles: Record<number, SeriesStyle>,
): Map<number, ColorScatterSpec> {
  const out = new Map<number, ColorScatterSpec>();
  plotted.forEach((ch, p) => {
    const style = seriesStyles[ch];
    const zCh = style?.colorBy;
    if (zCh == null) return;
    const z = ds.values.map((row) => (Number.isFinite(row[zCh]) ? row[zCh] : null));
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of z) {
      if (v == null) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (lo > hi) return; // no finite z values anywhere -> nothing to colour
    out.set(p + 1, { channel: zCh, z, colormap: style?.colormap ?? "viridis", lo, hi });
  });
  return out;
}

export interface ColorScaleLegendEntry {
  label: string;
  colormap: ColormapName;
  lo: number;
  hi: number;
}

/** Display-ready colour-scale entries for the colorbar chip — the channel's
 *  own label (or the spec's), so "colour = <label>" reads clearly even with
 *  multiple colour-mapped series on one plot. Identical entries collapse to
 *  one: series sharing one scale (a gradient over split series) need one key. */
export function colorScaleLegendEntries(
  ds: DataStruct,
  columns: Map<number, ColorScatterSpec>,
): ColorScaleLegendEntry[] {
  const seen = new Set<string>();
  return [...columns.values()].flatMap((spec) => {
    const e = { label: spec.label ?? ds.labels[spec.channel] ?? `channel ${spec.channel}`, colormap: spec.colormap, lo: spec.lo, hi: spec.hi };
    const key = JSON.stringify(e);
    return seen.has(key) ? [] : (seen.add(key), [e]);
  });
}
