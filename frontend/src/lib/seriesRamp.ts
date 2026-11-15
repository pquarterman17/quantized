// Colour gradient across a graph's N curves (origin gap audit 4 G1): Origin's
// colour-list / colormap increment. A graph with a ramp colours its plotted
// series by sampling a continuous colormap evenly from the first curve to the
// last, so 12 temperatures run blue to red instead of repeating the 8-colour
// palette. It is a per-graph setting (`PlotView.seriesRamp`), so it is saved
// with the window, undoable and carried by graph templates.
//
// THE RAMP IS RESOLVED ONCE, TO LITERAL HEX, ON THE CHANNEL STYLES. Every
// curve without an explicit colour gets `color: "#rrggbb"` on its channel
// style before anything draws (`seriesRampImpl.rampSeriesStyles`): the canvas
// (`Stage/useSeriesRamp`, ahead of `usePlotPayload` and the x-break panels),
// the legend that follows the canvas' style list, and the export
// (`figureSpec.buildFigureSpecForView`, ahead of `buildExportStyles`, which
// then ships those hexes as chosen colours). Neither side recomputes a colour
// the other picked, and the backend never learns that a ramp exists.
//
// THE SAME VIEWS REFUSE IT ON BOTH SIDES (`rampApplies`): a grouped, faceted,
// stacked, polar or statistics view, and a window whose document pins its
// publication styles or encodes colour by a factor — the same refusals the
// P3.3 cycle makes (`seriesStyleCycle.overlayModesMatchTheCanvas`), for the
// same reason: their export does not reproduce the flat series list. The gate
// is `seriesRampImpl.rampApplies`.
//
// This module is EAGER, small and pure: the type and its sanitizer. The gate,
// the colormaps and the resolver are `seriesRampImpl.ts`: the canvas reaches it
// through the lazy marks chunk, the export spec builder imports it.

export const RAMP_MAPS = ["viridis", "plasma", "magma", "cividis", "coolwarm", "turbo"] as const;
export type RampMap = (typeof RAMP_MAPS)[number];

/** A graph's colour gradient. `order: "value"` ranks the curves by the first
 *  number in each legend label (a temperature, a field) instead of their
 *  plotted order — used only when EVERY plotted curve's label has one. */
export interface SeriesRamp {
  map: RampMap;
  reverse?: boolean;
  order?: "index" | "value";
}

/** A valid ramp from untrusted input (a `.dwk`, a template), else null. */
export function sanitizeSeriesRamp(v: unknown): SeriesRamp | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!RAMP_MAPS.includes(o.map as RampMap)) return null;
  return { map: o.map as RampMap, ...(o.reverse === true ? { reverse: true } : {}), ...(o.order === "value" ? { order: "value" } : {}) };
}
