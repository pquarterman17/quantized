// Color-mapped scatter (MAIN #14): pair a plotted y-channel with a THIRD
// channel whose values pick each point's colour. The z values are just
// another channel of the same dataset, read client-side and aligned by row —
// no backend involvement for the interactive plot (the export path resolves
// the same channel index server-side, see `calc/plotting.resolve_style_channels`).
// This module is the pure, testable core; the canvas drawing lives in
// `uplotOverlays.colorScatterPlugin` — the same split `lib/errorbars.ts` uses
// for error-bar magnitudes.

import type { ColormapName } from "./colormap";
import type { DataStruct, SeriesStyle } from "./types";

export interface ColorScatterSpec {
  /** Source channel index (for the legend/colorbar label). */
  channel: number;
  z: (number | null)[];
  colormap: ColormapName;
  lo: number;
  hi: number;
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

/** Display-ready colour-scale entries (one per colour-mapped series) for the
 *  colorbar chip — the channel's own label, so "colour = <label>" reads
 *  clearly even with multiple colour-mapped series on one plot. */
export function colorScaleLegendEntries(
  ds: DataStruct,
  columns: Map<number, ColorScatterSpec>,
): ColorScaleLegendEntry[] {
  return [...columns.values()].map((spec) => ({
    label: ds.labels[spec.channel] ?? `channel ${spec.channel}`,
    colormap: spec.colormap,
    lo: spec.lo,
    hi: spec.hi,
  }));
}
