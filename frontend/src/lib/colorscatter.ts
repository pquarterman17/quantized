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

import type { ColormapName } from "./colormap";
import type { SizeKey } from "./sizescatter";
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
  /** Gap audit 2 #6: open symbols (`SeriesStyle.markerFill: "hollow"`). */
  hollow?: boolean;
  /** N5 size-by (built by the lazy `marksImpl.withSizes`): the legend key and
   *  the per-row marker DIAMETERS in px (null = no point), aligned like `z`. */
  size?: SizeKey;
  diam?: (number | null)[];
  /** A size-only series: the points take the series' stroke; no colour scale. */
  flat?: boolean;
  /** G24 row states: explicit per-row fill (`#rrggbb`) and glyph, aligned like
   *  `z`; null = this row has none and takes the underlying rule (the colour
   *  scale, else the series' stroke and glyph). */
  fills?: (string | null)[];
  shapes?: (MarkerShape | null)[];
  /** Plan item 24 (set by the lazy `marksImpl.withSizes`): the series draws text symbols, which replace the
   *  points (the export draws the same), so the points are not painted under the text. */
  text?: boolean;
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
    out.set(p + 1, {
      channel: zCh, z, colormap: style?.colormap ?? "viridis", lo, hi,
      ...(style?.markerFill === "hollow" ? { hollow: true } : {}),
    });
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
    if (spec.flat) return [];
    const e = { label: spec.label ?? ds.labels[spec.channel] ?? `channel ${spec.channel}`, colormap: spec.colormap, lo: spec.lo, hi: spec.hi };
    const key = JSON.stringify(e);
    return seen.has(key) ? [] : (seen.add(key), [e]);
  });
}

// The fill rule and the marker painter live in ./colorscatterPaint.ts (bundle
// diet slice 32), re-exported so every importer is unchanged.
export * from "./colorscatterPaint";
