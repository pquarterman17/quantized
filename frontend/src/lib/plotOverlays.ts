// Scatter overlays (gap audit 8, SCAT): a line of fit (with an optional
// confidence / prediction band), a LOWESS smoother and a density ellipse, drawn
// over ANY plotted series. A per-graph setting (`PlotView.overlays`), OFF by
// default (null), saved with the plot and sent to the vector export as
// `overrides.overlays`. The maths is one backend computation
// (`calc/figure_overlays.py`): the live plot posts to `/api/plot/overlays` and
// the export draws the same result, so screen and export agree. The canvas side
// is the lazy `plotOverlaysDraw.ts`. This module is only the eager model.

export type OverlayBand = "none" | "confidence" | "prediction";

export interface PlotOverlays {
  line: { band: OverlayBand; level: number } | null;
  smoother: { span: number } | null;
  ellipse: { level: number } | null;
}

export const OVERLAY_LEVELS = [0.68, 0.9, 0.95, 0.99] as const;
export const DEFAULT_OVERLAY_LEVEL = 0.95;
export const DEFAULT_SMOOTHER_SPAN = 0.5;
const BANDS: readonly OverlayBand[] = ["none", "confidence", "prediction"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const level = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1 ? v : DEFAULT_OVERLAY_LEVEL;

/** True when at least one overlay is on. */
export function overlaysOn(o: PlotOverlays | null | undefined): o is PlotOverlays {
  return !!o && !!(o.line || o.smoother || o.ellipse);
}

/** A stored value (a `.dwk`, a template, a recipe) -> a valid overlay set, or
 *  null (off). Unknown or malformed pieces are dropped rather than trusted. */
export function sanitizePlotOverlays(raw: unknown): PlotOverlays | null {
  if (!isObj(raw)) return null;
  const line = isObj(raw.line)
    ? { band: BANDS.includes(raw.line.band as OverlayBand) ? (raw.line.band as OverlayBand) : "none", level: level(raw.line.level) }
    : null;
  const span = isObj(raw.smoother) ? raw.smoother.span : null;
  const smoother =
    isObj(raw.smoother) ? { span: typeof span === "number" && span >= 0.05 && span <= 1 ? span : DEFAULT_SMOOTHER_SPAN } : null;
  const ellipse = isObj(raw.ellipse) ? { level: level(raw.ellipse.level) } : null;
  const out = { line, smoother, ellipse };
  return overlaysOn(out) ? out : null;
}

/** The wire form (`overrides.overlays`, `POST /api/plot/overlays`): only the
 *  overlays that are on; undefined when none are. */
export function overlaysWire(o: PlotOverlays | null | undefined): Record<string, unknown> | undefined {
  if (!overlaysOn(o)) return undefined;
  return {
    ...(o.line ? { line: { band: o.line.band, level: o.line.level } } : {}),
    ...(o.smoother ? { smoother: { span: o.smoother.span } } : {}),
    ...(o.ellipse ? { ellipse: { level: o.ellipse.level } } : {}),
  };
}

/** Why the overlays cannot be drawn on this view at all (the backend refuses the
 *  same cases for the export), or null. Overlays are fitted in data space. */
export function overlayViewRefusal(v: {
  xScale: string;
  yScale: string;
  exchangeXY: boolean;
  waterfall: number;
  waterfallDx: number;
}): string | null {
  if (v.xScale !== "linear" || v.yScale !== "linear") return "need linear axes (not log or reciprocal)";
  if (v.exchangeXY) return "are not drawn with exchanged X and Y axes";
  if (v.waterfall !== 0 || v.waterfallDx !== 0) return "are not drawn on a waterfall (its offsets are display-only)";
  return null;
}
