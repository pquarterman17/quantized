// Build per-series style specs for the publication export, in plotted (display)
// order, so the matplotlib figure matches the on-screen uPlot styling. Colors are
// resolved to hex (matplotlib can't parse OKLCH tokens); width/line/marker come
// straight from the per-channel overrides. Aligns 1:1 with the route's y_keys.

import { resolveToHex } from "./color";
import type { SeriesStyle } from "./types";
import { seriesColor } from "./uplotOpts";

export interface ExportSeriesStyle {
  color?: string;
  width?: number;
  line?: string;
  connect?: "straight" | "segment2";
  marker?: boolean;
  marker_size?: number;
  /** Fill under/between curves (MAIN #13) — mirrors `SeriesStyle.fill`, but
   *  `vs` here is still a dataset *channel index* (the SAME semantic as the
   *  screen side); the backend resolves it against the request's `y_keys`
   *  (`calc/plotting.resolve_style_channels`), matching the frontend's own
   *  "only a currently-plotted channel resolves" fallback. */
  fill?: "under" | { vs: number };
  /** Colour-mapped scatter (MAIN #14) — a dataset channel index; the backend
   *  resolves it to the channel's concrete value array server-side (it
   *  already has the full dataset in the request), so this wire field is
   *  just the index, same as the screen-side `SeriesStyle.colorBy`. */
  color_by?: number;
  colormap?: string;
}

/** `plotted` = the channel indices being drawn (yKeys ?? all channels), in order.
 *  Returns one spec per series (null = no styling → matplotlib defaults). */
export function buildExportStyles(
  plotted: number[],
  seriesStyles: Record<number, SeriesStyle>,
): (ExportSeriesStyle | null)[] {
  return plotted.map((ch, i) => {
    const st = seriesStyles[ch];
    const spec: ExportSeriesStyle = {};
    const hex = resolveToHex(seriesColor(i, st)); // palette-by-position or override
    if (hex) spec.color = hex;
    if (st?.width != null) spec.width = st.width;
    if (st?.line) spec.line = st.line;
    if (st?.connect) spec.connect = st.connect;
    if (st?.marker) {
      spec.marker = true;
      if (st.markerSize != null) spec.marker_size = st.markerSize;
    }
    if (st?.fill && st.fill !== "none") spec.fill = st.fill;
    if (st?.colorBy != null) {
      spec.color_by = st.colorBy;
      spec.colormap = st.colormap ?? "viridis";
    }
    return Object.keys(spec).length > 0 ? spec : null;
  });
}
