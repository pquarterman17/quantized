import type uPlot from "uplot";
import { describe, expect, it, vi } from "vitest";

import { logGaps } from "./logGaps";
import type { PlotPayload } from "./plotdata";
import { buildOpts } from "./uplotOpts";

/** A uPlot stand-in: x pixel = 10·x, the given scale distributions. */
const plot = (xs: number[], ys: (number | null)[], yDistr = 3, xDistr = 1) =>
  ({
    data: [xs, ys],
    series: [{}, { scale: "y" }],
    scales: { x: { distr: xDistr }, y: { distr: yDistr } },
    valToPos: (v: number) => 10 * v,
  }) as unknown as uPlot;

describe("logGaps: values a log axis cannot place break the line", () => {
  // A spin-flip PNR curve: R <= 0 where the background subtraction overshoots.
  const xs = [1, 2, 3, 4, 5, 6, 7];
  const ys = [1e-3, 2e-4, -1e-5, 0, 3e-5, 4e-5, 1e-5];

  it("spans each such point from its neighbour before to its neighbour after", () => {
    // The run at x = 3, 4 chains into one break from x = 2 to x = 5.
    expect(logGaps(plot(xs, ys), 1, 0, 6, [])).toEqual([
      [20, 40],
      [30, 50],
    ]);
  });

  it("merges them with uPlot's own null gaps in x order", () => {
    const withNull = [...ys.slice(0, 6), null];
    expect(logGaps(plot(xs, withNull), 1, 0, 6, [[60, 70]])).toEqual([
      [20, 40],
      [30, 50],
      [60, 70],
    ]);
    expect(logGaps(plot(xs, ys), 1, 0, 6, [[10, 15]])).toEqual([
      [10, 15],
      [20, 40],
      [30, 50],
    ]);
  });

  it("covers a run at either end of the window", () => {
    expect(logGaps(plot(xs, [-1, 1, 1, 1, 1, 1, 0]), 1, 0, 6, [])).toEqual([
      [10, 20],
      [60, 70],
    ]);
  });

  it("leaves a linear axis alone", () => {
    const gaps: [number, number][] = [];
    expect(logGaps(plot(xs, ys, 1), 1, 0, 6, gaps)).toBe(gaps);
  });

  it("breaks at x <= 0 on a log x axis", () => {
    expect(logGaps(plot([-1, 0, 1, 2], [1, 1, 1, 1], 1, 3), 1, 0, 3, [])).toEqual([
      [-10, 0],
      [-10, 10],
    ]);
  });
});

describe("buildOpts gives each drawn line the log gaps", () => {
  const args = { width: 600, height: 400, xScale: "linear" as const, yScale: "log" as const, tool: "zoom" as const, onReadout: vi.fn() };
  const payload = (xs: number[]): PlotPayload => ({
    data: [xs, [1, -1, 2]],
    series: [{ label: "R", unit: "" }],
    xLabel: "Q",
    xUnit: "1/A",
  });

  it("on ascending x", () => {
    expect(buildOpts(payload([1, 2, 3]), args).series[1].gaps).toBe(logGaps);
  });

  it("not on non-monotonic x, where an x-pixel gap would clip the other branch", () => {
    expect(buildOpts(payload([1, 3, 2]), args).series[1].gaps).toBeUndefined();
  });
});
