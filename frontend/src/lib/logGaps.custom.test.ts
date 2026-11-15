// Gap audit 4 G17 review M1: a probability (or reciprocal) axis is uPlot
// `distr: 100`; a value its transform cannot place (NaN) breaks the line, as
// the export's NaN break does, rather than the canvas joining across it.

import type uPlot from "uplot";
import { describe, expect, it } from "vitest";

import { logGaps } from "./logGaps";

describe("logGaps: a custom scale breaks at points it cannot place", () => {
  it("fraction Y [0.2, 1.0, 0.8] on a probability axis: no segment through 1.0", () => {
    const u = {
      data: [[1, 2, 3], [0.2, 1.0, 0.8]],
      series: [{}, { scale: "y" }],
      scales: { x: { distr: 1 }, y: { distr: 100 } },
      valToPos: (v: number, key: string) => (key === "x" ? 10 * v : v > 0 && v < 1 ? v : NaN),
    } as unknown as uPlot;
    expect(logGaps(u, 1, 0, 2, [])).toEqual([[10, 30]]);
  });

  it("a custom X that cannot place a point breaks there too", () => {
    const u = {
      data: [[0.5, 0, 0.7], [1, 2, 3]],
      series: [{}, { scale: "y" }],
      scales: { x: { distr: 100 }, y: { distr: 1 } },
      valToPos: (v: number, key: string) => (key === "x" ? (v > 0 ? 10 * v : NaN) : v),
    } as unknown as uPlot;
    const gaps = logGaps(u, 1, 0, 2, []);
    expect(gaps).toHaveLength(1);
  });

  it("a broken (distr 100) axis that places everything adds no gap", () => {
    const u = {
      data: [[1, 2, 3], [5, 6, 7]],
      series: [{}, { scale: "y" }],
      scales: { x: { distr: 1 }, y: { distr: 100 } },
      valToPos: (v: number) => v,
    } as unknown as uPlot;
    expect(logGaps(u, 1, 0, 2, [])).toEqual([]);
  });
});
