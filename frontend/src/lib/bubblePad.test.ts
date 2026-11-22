// Bubble axis padding: the axis leaves room for the biggest bubble (Origin
// pads [0, 10] to about [-0.68, 10.46]); fixed limits and zooms are untouched.

import type uPlot from "uplot";
import { describe, expect, it } from "vitest";

import type { ColorScatterSpec } from "./colorscatter";
import { maxBubbleRadius, padBubbleScales, padForRadius } from "./bubblePad";

const spec = (diam: (number | null)[]): ColorScatterSpec => ({ channel: 1, z: [], colormap: "viridis", lo: 0, hi: 1, flat: true, diam });

function fakePlot(xs: number[], ys: number[]): uPlot {
  return { scales: { x: {}, y: {} }, data: [xs, ys], series: [{}, { show: true, scale: "y" }], bbox: { width: 600, height: 400 }, width: 700, height: 500 } as unknown as uPlot;
}

describe("bubble axis padding", () => {
  it("the maximum radius is half the biggest diameter", () => {
    expect(maxBubbleRadius([spec([4, 14, null])])).toBe(7);
  });

  it("padForRadius leaves the radius of room on each side", () => {
    const [lo, hi] = padForRadius(0, 10, 0, 10, 7, 600);
    const m = (7 * (hi - lo)) / 600;
    expect(lo).toBeCloseTo(-m, 6);
    expect(hi).toBeCloseTo(10 + m, 6);
    expect(lo).toBeLessThan(0);
  });

  it("an autoscaled axis is widened past the data; a fixed limit and a zoom are not", () => {
    const u = fakePlot([0, 5, 10], [0, 5, 10]);
    const scales: uPlot.Scales = { x: {}, y: { range: [0, 10] } };
    padBubbleScales(scales, new Map([[1, spec([4, 9, 14])]]));
    const xr = scales.x.range as uPlot.Range.Function;
    const [lo, hi] = xr(u, 0, 10, "x") as [number, number];
    expect(lo).toBeLessThan(-0.1);
    expect(hi).toBeGreaterThan(10.1);
    expect(xr(u, 2, 8, "x")).toEqual([2, 8]); // a zoom keeps its bounds
    expect(scales.y.range).toEqual([0, 10]); // a fixed yLim stays
  });

  it("no sized series: scales are left alone", () => {
    const scales: uPlot.Scales = { x: {}, y: {} };
    padBubbleScales(scales, new Map());
    expect(scales.x.range).toBeUndefined();
  });
});
