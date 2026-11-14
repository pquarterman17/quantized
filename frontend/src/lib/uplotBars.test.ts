import { describe, expect, it } from "vitest";

import { BAR_PATHS } from "./uplotBars";

// A stand-in uPlot: x and y map 1:1 to pixels (y grows downward like canvas,
// so value v sits at pixel 100 - v), and Path2D records its rects.
class FakePath { rects: number[][] = []; rect(...r: number[]) { this.rects.push(r); } }

describe("BAR_PATHS (an Origin column graph's bars)", () => {
  it("one bar per point, from zero, 60% of the smallest X gap wide; a null draws nothing", () => {
    const g = globalThis as unknown as { Path2D: unknown };
    const saved = g.Path2D;
    g.Path2D = FakePath;
    try {
      const u = {
        data: [[10, 20, 40, 50], [5, null, -3, 8]],
        series: [{}, { scale: "y" }],
        valToPos: (v: number, scale: string) => (scale === "x" ? v : 100 - v),
      };
      const out = (BAR_PATHS as unknown as (...a: unknown[]) => { stroke: FakePath; fill: FakePath })(u, 1, 0, 3);
      // smallest gap 10 px -> width 6; zero at pixel 100
      expect(out.stroke.rects).toEqual([
        [7, 95, 6, 5],
        [37, 100, 6, 3], // negative value: bar hangs below zero
        [47, 92, 6, 8],
      ]);
      expect(out.fill).toBe(out.stroke);
    } finally {
      g.Path2D = saved;
    }
  });

  it("on a plot turned for horizontal bars the bars run along the value axis", () => {
    const g = globalThis as unknown as { Path2D: unknown };
    const saved = g.Path2D;
    g.Path2D = FakePath;
    try {
      // x scale vertical (ori 1): X value v sits at pixel 100 - v; the value
      // axis runs left to right, value v at pixel 50 + v.
      const u = {
        data: [[10, 20], [5, -3]],
        series: [{}, { scale: "y" }],
        scales: { x: { ori: 1 } },
        valToPos: (v: number, scale: string) => (scale === "x" ? 100 - v : 50 + v),
      };
      const out = (BAR_PATHS as unknown as (...a: unknown[]) => { stroke: FakePath })(u, 1, 0, 1);
      // gap 10 px -> thickness 6; zero at pixel 50
      expect(out.stroke.rects).toEqual([
        [50, 87, 5, 6],
        [47, 77, 3, 6], // negative value: the bar runs left of zero
      ]);
    } finally {
      g.Path2D = saved;
    }
  });
});
