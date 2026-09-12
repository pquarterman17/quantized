// Build per-series style specs for the publication export, in plotted (display)
// order, so the matplotlib figure matches the on-screen uPlot styling. Colors are
// resolved to hex (matplotlib can't parse OKLCH tokens); width/line/marker come
// straight from the per-channel overrides. Aligns 1:1 with the route's y_keys.

import { resolveToHex } from "./color";
import type { ExportSeriesStyle } from "./publicationStyles";
import type { SeriesStyle } from "./types";
import { resolveSeriesStyle, seriesColor, type SeriesCycle } from "./seriesStyleCycle";

export type { ExportSeriesStyle } from "./publicationStyles";

/** `plotted` = the channel indices being drawn (yKeys ?? all channels), in order.
 *  Returns one spec per series (null = no styling → matplotlib defaults).
 *
 *  `cycle` (P3.3, `lib/seriesStyleCycle.ts`) is the CANVAS' display position
 *  for each entry of `plotted`, and `null`/absent — the default for every
 *  producer that has no paired canvas (`legacyFigure`, `useGraphTemplates`,
 *  `plotSpecFigure`) — makes this function byte-identical to what it was before
 *  the cycle existed. It matters because `plotted` here is hidden-FILTERED
 *  while the canvas keeps hidden series in place with `show:false`: passing the
 *  canvas' positions is what stops channel B drawing dashed on screen and solid
 *  in the PDF. It also fixes the same skew in the palette, since `seriesColor`
 *  is indexed by the same position. */
export function buildExportStyles(
  plotted: number[],
  seriesStyles: Record<number, SeriesStyle>,
  cycle: SeriesCycle = null,
): (ExportSeriesStyle | null)[] {
  return plotted.map((ch, i) => {
    // The EFFECTIVE style — the stored per-channel style plus the P3.3 auto
    // dash/marker cycle when this producer opted in. This is the ONE reason the
    // export cannot diverge from the canvas: `uplotOpts.buildOpts` calls the
    // same `resolveSeriesStyle` against the same display-position list, so the
    // backend never learns that a cycle exists — it just receives an ordinary
    // explicit `line`/`marker_shape` and renders it (the faceted-styling
    // attempt that shipped a screen-only change is FEATURE-001 in
    // plans/BUGS_AND_ISSUES.md; this is the shape that avoids repeating it).
    const st = resolveSeriesStyle(seriesStyles[ch], i, cycle);
    const pos = cycle?.[i] ?? i;
    const spec: ExportSeriesStyle = {};
    const hex = resolveToHex(seriesColor(pos, st)); // palette-by-position or override
    if (hex) spec.color = hex;
    if (st?.width != null) spec.width = st.width;
    if (st?.line) spec.line = st.line;
    if (st?.marker) {
      spec.marker = true;
      if (st.markerSize != null) spec.marker_size = st.markerSize;
      // Without this the backend's marker-shape table is unreachable and every
      // exported marker is a filled circle, whatever shape the canvas drew
      // (`uplotOpts.ts` honours `markerShape`; `calc/figure.py` did not).
      // Emitted here rather than at a call site so every producer of export
      // styles gets it — spatialPageExport, legacyFigure, useGraphTemplates
      // and plotSpecFigure all route through this one builder.
      if (st.markerShape) spec.marker_shape = st.markerShape;
    }
    if (st?.fill && st.fill !== "none") spec.fill = st.fill;
    if (st?.step) spec.step = st.step;
    if (st?.colorBy != null) {
      spec.color_by = st.colorBy;
      spec.colormap = st.colormap ?? "viridis";
    }
    return Object.keys(spec).length > 0 ? spec : null;
  });
}
