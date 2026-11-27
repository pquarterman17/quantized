// The plot-click gesture tools' plugins (Lasso Mask, gap audit 4 G19; Pick
// points, gap plan item 22), chosen for the armed tool. Each has its OWN
// callback: a Pick click never travels the lasso's outline channel. Once
// anything is picked, every other tool's chart also carries the markers.
// Part of the lazy tool-plugin chunk (`lib/uplotToolPlugins.ts`); extracted
// from uplotOpts.ts (size ratchet).

import type uPlot from "uplot";

import { lassoPlugin, pickPlugin } from "./uplotLasso";
import { hasPicks, pickMarksPlugin } from "./uplotPickMarks";
import type { PlotTool } from "./uplotOpts";

export interface GestureHandlers {
  onLasso?: (u: uPlot, poly: [number, number][], unmask: boolean) => void; // a released outline, css px
  onPick?: (u: uPlot, at: [number, number]) => void; // a click, css px
}

export function gesturePlugins(tool: PlotTool, h: GestureHandlers, accent: string): uPlot.Plugin[] {
  const marks = hasPicks() ? [pickMarksPlugin()] : []; // a DOM layer, so it never reaches a PNG export
  if (tool === "lasso" && h.onLasso) return [lassoPlugin(h.onLasso, accent), ...marks];
  if (tool === "pick" && h.onPick) return [pickPlugin(h.onPick)]; // it draws the markers itself
  return marks;
}
