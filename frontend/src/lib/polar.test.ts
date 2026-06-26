import { describe, expect, it } from "vitest";

import { polarToXY, radiusNorm } from "./polar";

describe("polarToXY", () => {
  const cx = 100;
  const cy = 100;
  const R = 50;

  it("places cardinal angles correctly (0° east, 90° up, CCW)", () => {
    const close = (a: [number, number], b: [number, number]) => {
      expect(a[0]).toBeCloseTo(b[0], 6);
      expect(a[1]).toBeCloseTo(b[1], 6);
    };
    close(polarToXY(0, 1, cx, cy, R), [150, 100]); // east
    close(polarToXY(90, 1, cx, cy, R), [100, 50]); // up (canvas y smaller)
    close(polarToXY(180, 1, cx, cy, R), [50, 100]); // west
    close(polarToXY(270, 1, cx, cy, R), [100, 150]); // down
  });

  it("puts radius 0 at the centre", () => {
    expect(polarToXY(37, 0, cx, cy, R)).toEqual([cx, cy]);
  });
});

describe("radiusNorm", () => {
  it("maps vmin->0 and vmax->1", () => {
    expect(radiusNorm(-5, -5, 5)).toBe(0);
    expect(radiusNorm(5, -5, 5)).toBe(1);
    expect(radiusNorm(0, -5, 5)).toBe(0.5);
  });
  it("clamps out-of-range and degenerate inputs", () => {
    expect(radiusNorm(10, 0, 1)).toBe(1);
    expect(radiusNorm(-10, 0, 1)).toBe(0);
    expect(radiusNorm(1, 5, 5)).toBe(0); // degenerate
    expect(radiusNorm(NaN, 0, 1)).toBe(0);
  });
});
