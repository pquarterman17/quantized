// Data to plot-area px on any plot, upright or turned (lib/uplotPointer.ts has the notes). Kept apart from it: only
// the lazy pointer tools (lasso, Pick, the pick markers) place data, and the eager box tool must not carry it.
import type uPlot from "uplot";

import { turnedPlot } from "./uplotPointer";

/** The [horizontal, vertical] px of the data point (`x` on the X scale, `y` on scale `key`). */
export function dataToPx(u: uPlot, x: number, y: number, key: string): [number, number] {
  const [a, b] = [u.valToPos(x, "x", false), u.valToPos(y, key, false)];
  return turnedPlot(u) ? [b, a] : [a, b];
}
