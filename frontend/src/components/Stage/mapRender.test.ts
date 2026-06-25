import { describe, expect, it } from "vitest";

import type { MapPayload } from "../../lib/mapdata";
import { fmt, hitTest, minPositive } from "./mapRender";

describe("fmt", () => {
  it("trims to <=4 significant figures", () => {
    expect(fmt(61.00000001)).toBe("61");
    expect(fmt(1036.0)).toBe("1036");
  });
  it("uses exponential outside [1e-3, 1e5)", () => {
    expect(fmt(4.2e7)).toBe("4.20e+7");
    expect(fmt(0.00001)).toBe("1.00e-5");
  });
  it("renders non-finite as an em dash", () => {
    expect(fmt(NaN)).toBe("—");
  });
});

describe("minPositive", () => {
  it("finds the smallest strictly-positive finite cell", () => {
    expect(minPositive([[3, -1, 0], [null, 0.5, 9]])).toBe(0.5);
  });
  it("returns null when nothing is positive", () => {
    expect(minPositive([[0, -2], [null, NaN]])).toBeNull();
  });
});

const P: MapPayload = {
  xAxis: [0, 1, 2],
  yAxis: [0, 1, 2],
  zGrid: [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ],
  xLabel: "x",
  xUnit: "",
  yLabel: "y",
  yUnit: "",
  zLabel: "z",
  zUnit: "",
  zMin: 1,
  zMax: 9,
};

describe("hitTest", () => {
  // For 600×400: plot rect = {x:58, y:14, w:464, h:344}.
  it("maps the plot-area centre to the centre cell", () => {
    const r = hitTest(P, 600, 400, 58 + 232, 14 + 172);
    expect(r).not.toBeNull();
    expect(r!.x).toBeCloseTo(1, 6);
    expect(r!.y).toBeCloseTo(1, 6);
    expect(r!.z).toBe(5);
  });
  it("flips y: the top-left corner is (xmin, ymax) -> grid row ny-1", () => {
    const r = hitTest(P, 600, 400, 58, 14);
    expect(r!.x).toBeCloseTo(0, 6);
    expect(r!.y).toBeCloseTo(2, 6);
    expect(r!.z).toBe(7); // zGrid[2][0]
  });
  it("returns null outside the plot area", () => {
    expect(hitTest(P, 600, 400, 10, 10)).toBeNull();
  });
});
