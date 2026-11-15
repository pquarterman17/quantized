// The pure halves of the x-break row's layout (batch 34): how the free width
// is shared out, and which x tick labels a seam hides.
import { describe, expect, it } from "vitest";

import type uPlot from "uplot";

import { tickFormatter } from "../../lib/uplotOpts";
import { breakPlotWidths, MIN_BREAK_PLOT_W, SEAM_PAD, seamXValues } from "./breakPanelLayout";

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
    expect(vals(u, [0.2, 5, 9.8], 0, 50, 4.8)).toEqual([null, "5.0", null]); // near, not on, the edges
  });

  it("aligns a label ON the seam edge inward instead of blanking it (audit 6 review H1)", () => {
    const vals = seamXValues(base, { left: true, right: true }, 10, 4);
    expect(vals(u, [0, 5, 10], 0, 50, 5)).toEqual(["   0.0", "5.0", "10.0    "]);
  });

  it("leaves an outer edge's label alone", () => {
    const vals = seamXValues(base, { left: false, right: true }, 10, 4);
    expect(vals(u, [0, 5, 10], 0, 50, 5)).toEqual(["0.0", "5.0", "10.0    "]);
  });
});

describe("the break's own limits stay labelled with padded auto labels (audit 6 review H1)", () => {
  // The regression-matrix break: x [0, 5], break [2, 3]. Padded auto labels
  // made the seam-edge "2" a "2.0", wider than SEAM_PAD's 4 px allowed, and
  // the seam blanked both of the break's limits.
  const panel = (min: number, max: number) =>
    ({ scales: { x: { min, max } }, valToPos: (v: number) => ((v - min) / (max - min)) * 200 }) as unknown as uPlot;
  const auto = tickFormatter({ mode: "auto", digits: 3 }, "linear") as Parameters<typeof seamXValues>[0];

  it("draws 2.0 left of the seam and 3.0 right of it", () => {
    const left = seamXValues(auto, { left: false, right: true }, 12, SEAM_PAD)(panel(0, 2), [0, 0.5, 1, 1.5, 2], 0, 50, 0.5);
    expect(left.map((s) => (s == null ? s : String(s).trim()))).toEqual(["0.0", "0.5", "1.0", "1.5", "2.0"]);
    expect(left[4]).toBe("2.0   "); // its glyphs end on the edge
    const right = seamXValues(auto, { left: true, right: false }, 12, SEAM_PAD)(panel(3, 5), [3, 3.5, 4, 4.5, 5], 0, 50, 0.5);
    expect(right[0]).toBe("   3.0");
  });
});
