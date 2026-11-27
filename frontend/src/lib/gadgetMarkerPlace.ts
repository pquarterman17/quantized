// Where a curve-measurement gadget marker may be drawn (lib/uplotGadgetMarkers).
// A marker is at DATA coordinates of the curve it was measured on, so it must be
// placed on the scale that curve is drawn against (Y1, Y2, Y3+), and never on a
// view that moves or turns the curve without moving the number: those hide the
// marker and say why (the chip prints the reason), they do not draw it wrong.
// The same predicate serves the canvas (with the live plot) and the chip (without).
// Loaded with the gadget plugins and the chip, never eagerly.

import type uPlot from "uplot";

import { measureMarkers, type GadgetMeasure } from "./gadgetMeasure";
import { effectiveChannels } from "./plotdata";
import type { SeriesStyle } from "./seriesStyleTypes";
import { turnedOf } from "./uplotOrient";
import { waterfallApplies, waterfallXApplies } from "./waterfallOffset";
import type { Dataset } from "./types";

/** The slice of the store the placement reads. */
export interface PlaceView {
  datasets: readonly Dataset[];
  activeId: string | null;
  xKey: number | null;
  yKeys: number[] | null;
  seriesOrder: number[] | null;
  exchangeXY: boolean;
  seriesStyles: Record<number, SeriesStyle | undefined>;
  waterfall: number;
  waterfallDx: number;
}

export type Placement = { scale: string } | { why: string };

/** Why curve `yKey`'s measured numbers cannot be drawn on this view (null = they can). */
export function markerWhy(s: PlaceView, yKey: number): string | null {
  if (turnedOf(s)) return "the plot is turned (exchanged axes or horizontal bars)";
  const ds = s.datasets.find((d) => d.id === s.activeId);
  if (!ds) return "no worksheet is plotted";
  const plotted = effectiveChannels(ds.data, s.yKeys, s.xKey, ds.channelRoles, s.seriesOrder);
  const i = plotted.indexOf(yKey);
  if (i < 0) return "that curve is not plotted";
  // A waterfall offsets the DRAWN curves only (its offsets are display-only): the first stays put.
  if (plotted.length > 1 && waterfallXApplies(s.waterfallDx)) return "the waterfall shifts the curves along X";
  if (i > 0 && waterfallApplies(s.waterfall)) return "the waterfall lifts that curve (its offsets are display-only)";
  return null;
}

/** The uPlot scale curve `yKey` is drawn on, or why it cannot be placed. */
export function placeCurve(u: uPlot, s: PlaceView, yKey: number): Placement {
  const why = markerWhy(s, yKey);
  if (why) return { why };
  const ds = s.datasets.find((d) => d.id === s.activeId)!;
  // The plot's series run parallel to the plotted channels (lib/multiY.ts `withExtraYAxes`).
  const i = effectiveChannels(ds.data, s.yKeys, s.xKey, ds.channelRoles, s.seriesOrder).indexOf(yKey);
  const scale = u.series[i + 1]?.scale;
  return scale && u.scales[scale] ? { scale } : { why: "its axis is not drawn" };
}

/** Why a measurement's markers are hidden on this view (the first reason; null = all are drawn). */
export function measureWhy(s: PlaceView, m: GadgetMeasure): string | null {
  const { points, levels } = measureMarkers(m);
  for (const { yKey } of [...points, ...levels]) {
    const why = markerWhy(s, yKey);
    if (why) return why;
  }
  return null;
}
