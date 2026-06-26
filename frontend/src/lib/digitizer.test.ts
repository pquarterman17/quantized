import { describe, expect, it } from "vitest";

import { applyMap, calibrate, linearMap, pixelToData, tracedToData } from "./digitizer";

describe("linearMap", () => {
  it("maps two reference points exactly", () => {
    const m = linearMap({ px: 100, value: 0 }, { px: 300, value: 10 });
    expect(applyMap(m, 100)).toBeCloseTo(0, 9);
    expect(applyMap(m, 300)).toBeCloseTo(10, 9);
    expect(applyMap(m, 200)).toBeCloseTo(5, 9); // midpoint
  });

  it("handles an inverted (descending-pixel) axis — the Y case", () => {
    // Canvas y grows downward: top pixel (50) = data 10, bottom pixel (250) = data 0.
    const m = linearMap({ px: 50, value: 10 }, { px: 250, value: 0 });
    expect(m.scale).toBeLessThan(0);
    expect(applyMap(m, 50)).toBeCloseTo(10, 9);
    expect(applyMap(m, 250)).toBeCloseTo(0, 9);
  });

  it("degenerates to a constant when the two pixels coincide", () => {
    const m = linearMap({ px: 100, value: 5 }, { px: 100, value: 9 });
    expect(applyMap(m, 999)).toBe(5);
  });
});

describe("calibrate / pixelToData", () => {
  const cal = calibrate(
    { px: 100, value: 0 }, // x: 100px -> 0
    { px: 500, value: 8 }, // x: 500px -> 8
    { px: 60, value: 100 }, // y: 60px (top) -> 100
    { px: 360, value: 0 }, // y: 360px (bottom) -> 0
  );

  it("maps a pixel to data using both axis maps", () => {
    const [x, y] = pixelToData(cal, 300, 210);
    expect(x).toBeCloseTo(4, 9); // halfway in x
    expect(y).toBeCloseTo(50, 9); // halfway in y
  });
});

describe("tracedToData", () => {
  it("maps + sorts traced points by x ascending", () => {
    const cal = calibrate(
      { px: 0, value: 0 },
      { px: 100, value: 100 },
      { px: 0, value: 0 },
      { px: 100, value: 100 },
    );
    const out = tracedToData(cal, [
      { px: 80, py: 80 },
      { px: 20, py: 20 },
      { px: 50, py: 50 },
    ]);
    expect(out.x).toEqual([20, 50, 80]); // sorted
    expect(out.y).toEqual([20, 50, 80]);
  });
});
