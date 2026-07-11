// The generic point-gesture core's pure functions. These cases moved here
// from uplotAnchors.test.ts / peakMarkerHit.test.ts when the two near-clone
// implementations were consolidated (MAIN_PLAN #8) — the behaviour contract
// is unchanged, it just lives in one place now.

import { describe, expect, it } from "vitest";

import { hitTestPoints, pointPixels } from "./pointGesture";

describe("pointPixels", () => {
  it("maps data coords through valToPos, preserving index", () => {
    const u = { valToPos: (v: number, scale: string) => (scale === "x" ? v * 2 : v * 3) };
    const out = pointPixels(u, [{ index: 2, x: 10, y: 5 }]);
    expect(out).toEqual([{ index: 2, x: 10, y: 5, px: 20, py: 15 }]);
  });

  it("maps an empty list to an empty pixel list", () => {
    const u = { valToPos: (v: number) => v };
    expect(pointPixels(u, [])).toEqual([]);
  });
});

describe("hitTestPoints", () => {
  it("hits a point within tolerance", () => {
    const points = [{ index: 0, px: 100, py: 50 }];
    expect(hitTestPoints(points, { x: 104, y: 52 })).toBe(0);
  });

  it("returns null outside tolerance and for an empty list", () => {
    expect(hitTestPoints([{ index: 0, px: 100, py: 50 }], { x: 130, y: 50 })).toBeNull();
    expect(hitTestPoints([], { x: 0, y: 0 })).toBeNull();
  });

  it("nearest-wins among several points within tolerance", () => {
    const points = [
      { index: 0, px: 100, py: 50 },
      { index: 1, px: 104, py: 50 },
    ];
    expect(hitTestPoints(points, { x: 103, y: 50 })).toBe(1);
  });

  it("an exact-distance tie keeps the earlier (lower-index) point", () => {
    const points = [
      { index: 0, px: 96, py: 50 },
      { index: 1, px: 104, py: 50 },
    ];
    expect(hitTestPoints(points, { x: 100, y: 50 })).toBe(0);
  });

  it("uses Euclidean (2-D) distance — the marker is a point, not an x-band", () => {
    const points = [{ index: 0, px: 100, py: 100 }];
    expect(hitTestPoints(points, { x: 100, y: 50 }, 8)).toBeNull();
    expect(hitTestPoints(points, { x: 100, y: 95 }, 8)).toBe(0);
  });

  it("skips non-finite pixel positions (off-scale points)", () => {
    const points = [
      { index: 0, px: NaN, py: 50 },
      { index: 1, px: 100, py: 50 },
    ];
    expect(hitTestPoints(points, { x: 100, y: 50 })).toBe(1);
  });

  it("respects a custom tolerance", () => {
    const points = [{ index: 0, px: 100, py: 50 }];
    expect(hitTestPoints(points, { x: 110, y: 50 })).toBeNull();
    expect(hitTestPoints(points, { x: 110, y: 50 }, 12)).toBe(0);
  });
});
