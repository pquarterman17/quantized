// The export request's `layers` (origin gap audit 3 #15): each graph layer
// in the shape `calc/figure_layers.py` draws, with everything the screen
// resolved — an inset's curves read off their live sources, its axis ranges,
// tick positions and tick text, its curve colours — so the vector export is
// what the screen shows (`lib/graphLayers.ts`'s module doc). Pure but for
// the colour lookup (the theme's series palette); imported only by lazy
// export code and the lazy layer overlay.

import { resolveToHex } from "./color";
import {
  insetNotice,
  resolveInsetAxes,
  resolveInsetCurves,
  sanitizeLayers,
  type LayerAt,
  type LayerMark,
  type LayerScale,
  type ResolvedAxis,
} from "./graphLayers";
import { seriesColor } from "./seriesStyleCycle";
import type { Dataset } from "./types";

export interface LayerWireAxis {
  lim: [number, number];
  scale: LayerScale;
  label: string;
  ticks: number[];
  tick_labels: string[];
}

export type LayerWire =
  | {
      kind: "inset";
      at: LayerAt;
      x: LayerWireAxis;
      y: LayerWireAxis;
      mark: LayerMark;
      curves: { x: number[]; y: (number | null)[]; color: string }[];
      /** Shown inside the inset instead of curves (their sources are missing). */
      notice?: string;
    }
  | { kind: "image"; at: LayerAt; src: string }
  | { kind: "table"; at: LayerAt; rows: string[][]; header: boolean };

/** A curve slot's colour: the theme's series palette, as a hex the export
 *  can read. The screen draws with the same value. */
export function layerCurveColor(slot: number): string {
  const c = seriesColor(slot);
  return resolveToHex(c) ?? c;
}

const axisWire = (a: ResolvedAxis): LayerWireAxis => ({
  lim: [...a.range],
  scale: a.scale,
  label: a.label,
  ticks: [...a.ticks],
  tick_labels: [...a.labels],
});

/** The wire for `layers` over `datasets`; undefined when there are none. */
export function layersWire(
  layers: unknown,
  datasets: readonly Dataset[],
  color: (slot: number) => string = layerCurveColor,
): LayerWire[] | undefined {
  const out = sanitizeLayers(layers).map((l): LayerWire => {
    if (l.kind === "image") return { kind: "image", at: [...l.at], src: l.raster ?? l.src };
    if (l.kind === "table") return { kind: "table", at: [...l.at], rows: l.rows.map((r) => [...r]), header: l.header };
    const curves = resolveInsetCurves(l, datasets);
    const axes = resolveInsetAxes(l, curves);
    const notice = insetNotice(l, curves);
    return {
      kind: "inset",
      at: [...l.at],
      x: axisWire(axes.x),
      y: axisWire(axes.y),
      mark: l.mark,
      curves: curves.map((c) => ({ x: c.x, y: c.y, color: color(c.slot) })),
      ...(notice ? { notice } : {}),
    };
  });
  return out.length ? out : undefined;
}
