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
  marker?: boolean;
  marker_size?: number;
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
    if (st?.marker) {
      spec.marker = true;
      if (st.markerSize != null) spec.marker_size = st.markerSize;
    }
    return Object.keys(spec).length > 0 ? spec : null;
  });
}
