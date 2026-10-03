// Plot audit round 3: the map's colour bar labelled only its two ends, so a
// log RSM spanning eight decades (7.8e-6 … 1011 cps) gave no way to read a
// colour back as a value; the vector export's colour bar has ticks. Interior
// ticks: decades on a log scale, round values on a linear one.

import { describe, expect, it } from "vitest";

import { colorbarTicks } from "./mapColorbar";

describe("colorbarTicks", () => {
  it("marks the decades of a log range, thinned to at most six", () => {
    const ticks = colorbarTicks(7.82e-6, 1011, true, 600);
    // Every other decade from 1e-5; 1e-5 and 1e3 sit within 12 px of the ends.
    expect(ticks.map((t) => t.label)).toEqual(["1e-3", "0.1", "10"]);
    // Each sits at its value's fraction of the bar.
    const span = Math.log(1011) - Math.log(7.82e-6);
    expect(ticks[2].y).toBeCloseTo(((Math.log(10) - Math.log(7.82e-6)) / span) * 600);
  });

  it("marks every decade of a short log range", () => {
    expect(colorbarTicks(0.5, 2000, true, 400).map((t) => t.label)).toEqual(["1", "10", "100", "1e3"]);
  });

  it("marks round values of a linear range, leaving the ends to the range labels", () => {
    expect(colorbarTicks(0, 1000, false, 400).map((t) => t.label)).toEqual(["200", "400", "600", "800"]);
  });

  it("marks nothing on a log range that has no positive floor", () => {
    expect(colorbarTicks(0, 10, true, 400)).toEqual([]);
  });
});
