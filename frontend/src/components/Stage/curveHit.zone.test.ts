// UX menus audit M6: a curve is "under" a right-click only INSIDE the plotting
// rectangle. Below the X axis the probe x used to land on a data sample and
// name an unrelated curve; the Y axis never did, so the two axes disagreed.

import type uPlot from "uplot";
import { describe, expect, it } from "vitest";

import { hitTest } from "./curveHit";

// Plot rect [100,100]-[500,400]; posToVal / valToPos are identity.
const plot = {
  over: { getBoundingClientRect: () => ({ left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300 }) },
  data: [[0, 100, 200, 300, 400], [10, 20, 150, 40, 50]],
  series: [{}, { scale: "y" }],
  scales: { x: { min: 0, max: 400 }, y: { min: 0, max: 300 } },
  posToVal: (px: number) => px,
  valToPos: (v: number) => v,
} as unknown as uPlot;

describe("hitTest zones", () => {
  it("names the nearest curve inside the plot", () => {
    expect(hitTest(plot, 300, 250, [0], undefined, false, 24).series).toBe(0);
  });

  it("names no curve on the X-axis tick labels, even right under one", () => {
    // y = 420 is below the rect (zone "x"); the probe x = 200 has a sample at y = 150.
    const h = hitTest(plot, 300, 420, [0], undefined, false, 400);
    expect(h.zone).toBe("x");
    expect(h.series).toBeNull();
  });

  it("names no curve on the Y axis either (same answer on both axes)", () => {
    const h = hitTest(plot, 80, 250, [0], undefined, false, 400);
    expect(h.zone).toBe("y");
    expect(h.series).toBeNull();
  });
});
