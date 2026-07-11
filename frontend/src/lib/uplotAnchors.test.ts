import { describe, expect, it } from "vitest";

import { anchorPixels, hitTestAnchors } from "./uplotAnchors";

describe("anchorPixels", () => {
  it("maps anchor data coords through valToPos, preserving index", () => {
    const u = { valToPos: (v: number, scale: string) => (scale === "x" ? v * 2 : v * 3) };
    const out = anchorPixels(u, [{ index: 2, x: 10, y: 5 }]);
    expect(out).toEqual([{ index: 2, x: 10, y: 5, px: 20, py: 15 }]);
  });

  it("maps an empty anchor list to an empty pixel list", () => {
    const u = { valToPos: (v: number) => v };
    expect(anchorPixels(u, [])).toEqual([]);
  });
});

describe("hitTestAnchors", () => {
  it("hits an anchor within tolerance", () => {
    const anchors = [{ index: 0, px: 100, py: 50 }];
    expect(hitTestAnchors(anchors, { x: 104, y: 52 })).toBe(0);
  });

  it("returns null outside tolerance and for an empty list", () => {
    expect(hitTestAnchors([{ index: 0, px: 100, py: 50 }], { x: 130, y: 50 })).toBeNull();
    expect(hitTestAnchors([], { x: 0, y: 0 })).toBeNull();
  });

  it("nearest-wins among several anchors within tolerance", () => {
    const anchors = [
      { index: 0, px: 100, py: 50 },
      { index: 1, px: 104, py: 50 },
    ];
    expect(hitTestAnchors(anchors, { x: 103, y: 50 })).toBe(1);
  });

  it("an exact-distance tie keeps the earlier (lower-index) anchor", () => {
    const anchors = [
      { index: 0, px: 96, py: 50 },
      { index: 1, px: 104, py: 50 },
    ];
    expect(hitTestAnchors(anchors, { x: 100, y: 50 })).toBe(0);
  });

  it("uses Euclidean (2-D) distance — the marker is a point, not an x-band", () => {
    const anchors = [{ index: 0, px: 100, py: 100 }];
    expect(hitTestAnchors(anchors, { x: 100, y: 50 }, 8)).toBeNull();
    expect(hitTestAnchors(anchors, { x: 100, y: 95 }, 8)).toBe(0);
  });

  it("skips non-finite anchor positions (off-scale points)", () => {
    const anchors = [
      { index: 0, px: NaN, py: 50 },
      { index: 1, px: 100, py: 50 },
    ];
    expect(hitTestAnchors(anchors, { x: 100, y: 50 })).toBe(1);
  });

  it("respects a custom tolerance", () => {
    const anchors = [{ index: 0, px: 100, py: 50 }];
    expect(hitTestAnchors(anchors, { x: 110, y: 50 })).toBeNull();
    expect(hitTestAnchors(anchors, { x: 110, y: 50 }, 12)).toBe(0);
  });
});
