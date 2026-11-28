// The one pointer-to-data transform. uPlot's `ori` turns a scale's geometry (horizontal bars, Plot > Exchange X-Y
// axes: the "x" scale runs up the side, lib/uplotOrient.ts), but a mouse offset stays horizontal-then-vertical.
// Every pointer tool that reads an offset (the Select rows box, the lasso outline, a Pick click, the data slicer's
// painted box) goes through here, so a box drawn on a turned plot names the data under it exactly as an upright
// one does. Plot-area css px throughout (the origin is the top-left of `u.over`).
import type uPlot from "uplot";

/** Is X drawn up the side of `u` (a turned plot)? Tolerates a stand-in without scales. */
export const turnedPlot = (u: Pick<uPlot, "scales">): boolean => u.scales?.x?.ori === 1;

/** A plugin that works in plot-area css px (a pointer tool's outline, a DOM marker layer): a turned plot hands it the
 *  plot itself, not the upright view its draw hooks otherwise get (`lib/uplotTurn.ts`). */
export type RawPixelPlugin = uPlot.Plugin & { rawPixels: true };

/** `u.select` as `[off, len, cOff, cLen, full]`: its span along X's own axis, then across it, then the plot's own
 *  extent across X (0 if unknown). The box's width is X's span on an upright plot, its height on a turned one. */
export function selectSpan(u: uPlot): [number, number, number, number, number] {
  const { left, top, width, height = 0 } = u.select;
  const t = turnedPlot(u);
  return [t ? top : left, t ? height : width, t ? left : top, t ? width : height, (t ? u.over?.clientWidth : u.over?.clientHeight) ?? 0];
}
