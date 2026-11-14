// Horizontal bars (an Origin bar graph, plot type 215): the plot turns on
// its side. Origin draws such a layer with its X axis VERTICAL and Y along
// the bottom; uPlot does the same through scale orientation (`ori`), so the
// "x" scale still holds X — limits, formats and log state stay with the
// axis they belong to — and only the geometry rotates. `BAR_PATHS` reads
// the orientation and lays the bars along it; the export draws the same
// (`calc/figure_orient.py`).
//
// Applied when any series asks for horizontal bars (`SeriesStyle.bars ===
// "horizontal"`): Origin rotates the whole layer, not one curve.
import type uPlot from "uplot";
import type { SeriesStyle } from "./seriesStyleTypes";

export function hasHorizontalBars(styles: readonly (SeriesStyle | undefined)[] | undefined): boolean {
  return (styles ?? []).some((s) => s?.bars === "horizontal");
}

/** `{scales, axes}`, rotated for horizontal bars; unchanged otherwise. The
 *  X axis moves to the left (side 3) with the Y axis's measured gutter, the
 *  Y axis to the bottom (side 2) with the X axis's band height, and a
 *  secondary Y to the top (side 0). */
export function orientAxes(
  scales: uPlot.Scales,
  axes: uPlot.Axis[],
  styles: readonly (SeriesStyle | undefined)[] | undefined,
): { scales: uPlot.Scales; axes: uPlot.Axis[] } {
  if (!hasHorizontalBars(styles)) return { scales, axes };
  const turned: uPlot.Scales = {};
  for (const [key, sc] of Object.entries(scales)) turned[key] = { ...sc, ori: key === "x" ? 1 : 0 };
  const [x, y, ...rest] = axes;
  return {
    scales: turned,
    axes: [
      { ...x, side: 3, size: y?.size },
      { ...y, side: 2, size: x?.size },
      ...rest.map((a) => ({ ...a, side: 0 as const })),
    ],
  };
}
