// Point-label sizes on the canvas, in the export's own proportions (#1075).
//
// Sizes are points and mean what lands in the PDF (owner decision OG14); the canvas is a screen-scale
// preview. The export draws a label at matplotlib's "x-small" (0.694 of the 10 pt base font, 6.94 pt)
// against 10 pt ticks, and offsets, pads and keeps clear of the marker in points
// (calc/figure_point_label_place.py: 3, 0.75 and 2.5 pt). The canvas used a flat 11 px for the label,
// the same as its ticks, so it read 1.00 of the tick size where the export reads 0.69, and its slots
// (which depend on those sizes) could differ. Everything here is the export's value times the px per
// pt the ticks use (tick px / 10 pt), so the label-to-tick ratio and the slot rule see the same shape
// at both scales. Pinned against the export by tests/fixtures/wire/point_label_avoid_cluster.json.

/** The export's base font size, which its tick labels use unless the figure sets another. */
export const EXPORT_TICK_PT = 10;
/** matplotlib "x-small" (its font scaling table says 0.694: 6.94 pt of a 10 pt base). */
export const LABEL_TO_TICK = 0.694;
/** Export offsets in points (calc/figure_point_label_place.py `_GAP_PT`, `_PAD_PT`, `_MARKER_PT`). */
export const GAP_PT = 3;
export const PAD_PT = 0.75;
export const MARKER_PT = 2.5;
/** A fallback tick size on a canvas that reports none (CSS px). */
export const DEFAULT_TICK_PX = 11;

export interface LabelMetrics {
  /** Label font size, canvas px. */
  fontPx: number;
  /** Label box height (the export's `size * 1.2`). */
  h: number;
  /** Default-slot offset and the placement gap, the pad between boxes, the marker clearance. */
  gap: number;
  pad: number;
  markerR: number;
}

/** The label metrics for ticks drawn at `tickPx` canvas px (device px when the canvas is scaled). */
export function labelMetrics(tickPx: number): LabelMetrics {
  const k = tickPx / EXPORT_TICK_PT;
  const fontPx = tickPx * LABEL_TO_TICK;
  return { fontPx, h: fontPx * 1.2, gap: GAP_PT * k, pad: PAD_PT * k, markerR: MARKER_PT * k };
}

/** The canvas tick size in px, read from the x axis' font (uPlot keeps it as a CSS font string,
 *  already scaled to device pixels), else `fallback`. */
export function tickPxOf(font: unknown, fallback: number): number {
  const m = typeof font === "string" ? /(\d+(?:\.\d+)?)px/.exec(font) : null;
  const px = m ? Number(m[1]) : NaN;
  return Number.isFinite(px) && px > 0 ? px : fallback;
}
