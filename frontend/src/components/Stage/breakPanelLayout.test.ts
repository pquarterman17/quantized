// The pure halves of the x-break row's layout (batch 34): how the free width
// is shared out, and which x tick labels a seam hides.
import { describe, expect, it } from "vitest";

import type uPlot from "uplot";

import { breakPlotWidths, MIN_BREAK_PLOT_W, seamXValues } from "./breakPanelLayout";

describe("breakPlotWidths", () => {
  it("sizes plot areas by x span when every one clears the minimum", () => {
    expect(breakPlotWidths(600, [1, 2])).toEqual([200, 400]);
  });

  it("falls back to equal widths when a span-proportional one would drop below the minimum", () => {
    expect((240 * 1) / 12).toBeLessThan(MIN_BREAK_PLOT_W); // non-vacuous
    expect(breakPlotWidths(240, [10, 1, 1])).toEqual([80, 80, 80]);
  });

  it("returns nothing for no panels", () => {
    expect(breakPlotWidths(500, [])).toEqual([]);
  });
});

describe("seamXValues", () => {
  // A fake panel 100 px wide over x in [0, 10]: 1 data unit = 10 px.
  const u = {
    scales: { x: { min: 0, max: 10 } },
    valToPos: (v: number) => v * 10,
  } as unknown as uPlot;
  const base = (_u: uPlot, splits: number[]) => splits.map((v) => v.toFixed(1));

  it("blanks a label that would cross a seam edge and keeps the rest", () => {
    const vals = seamXValues(base, { left: true, right: true }, 10, 4);
    expect(vals(u, [0, 5, 10], 0, 50, 5)).toEqual([null, "5.0", null]);
  });

  it("leaves an outer edge's label alone", () => {
    const vals = seamXValues(base, { left: false, right: true }, 10, 4);
    expect(vals(u, [0, 5, 10], 0, 50, 5)).toEqual(["0.0", "5.0", null]);
  });
});
