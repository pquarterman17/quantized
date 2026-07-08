import { describe, expect, it } from "vitest";

import { hitTestPeakMarkers, peakMarkerPixels, visiblePeakMarkers } from "./peakMarkerHit";

describe("visiblePeakMarkers", () => {
  it("keeps only included candidates, tagged with their FULL-array index", () => {
    const candidates = [
      { center: 1, height: 10, included: true },
      { center: 2, height: 20, included: false },
      { center: 3, height: 30, included: true },
    ];
    expect(visiblePeakMarkers(candidates)).toEqual([
      { index: 0, center: 1, height: 10 },
      { index: 2, center: 3, height: 30 },
    ]);
  });

  it("returns an empty list for an empty candidate list", () => {
    expect(visiblePeakMarkers([])).toEqual([]);
  });

  it("returns an empty list when nothing is included", () => {
    expect(visiblePeakMarkers([{ center: 1, height: 1, included: false }])).toEqual([]);
  });
});

describe("peakMarkerPixels", () => {
  it("maps center/height through valToPos, preserving index", () => {
    const u = { valToPos: (v: number) => v * 2 };
    const out = peakMarkerPixels(u, [{ index: 3, center: 10, height: 5 }]);
    expect(out).toEqual([{ index: 3, center: 10, height: 5, x: 20, y: 10 }]);
  });

  it("maps an empty marker list to an empty pixel list", () => {
    const u = { valToPos: (v: number) => v };
    expect(peakMarkerPixels(u, [])).toEqual([]);
  });
});

describe("hitTestPeakMarkers", () => {
  it("hits a marker within tolerance", () => {
    const markers = [{ index: 0, x: 100, y: 50 }];
    expect(hitTestPeakMarkers(markers, { x: 104, y: 52 })).toBe(0);
  });

  it("returns null outside tolerance", () => {
    const markers = [{ index: 0, x: 100, y: 50 }];
    expect(hitTestPeakMarkers(markers, { x: 130, y: 50 })).toBeNull();
  });

  it("returns null for an empty marker list", () => {
    expect(hitTestPeakMarkers([], { x: 0, y: 0 })).toBeNull();
  });

  it("nearest-wins among several markers within tolerance", () => {
    const markers = [
      { index: 0, x: 100, y: 50 },
      { index: 1, x: 104, y: 50 }, // 4px from pointer — nearer
      { index: 2, x: 96, y: 50 }, // 4px from pointer too, but later in the list
    ];
    // pointer sits 4px from both #1 and #2 and 0px... make #1 strictly nearest
    expect(hitTestPeakMarkers(markers, { x: 103, y: 50 })).toBe(1);
  });

  it("an exact-distance tie keeps the earlier (lower-index) marker", () => {
    const markers = [
      { index: 0, x: 96, y: 50 },
      { index: 1, x: 104, y: 50 },
    ];
    // pointer is exactly 4px from both
    expect(hitTestPeakMarkers(markers, { x: 100, y: 50 })).toBe(0);
  });

  it("respects a custom tolerance", () => {
    const markers = [{ index: 0, x: 100, y: 50 }];
    expect(hitTestPeakMarkers(markers, { x: 110, y: 50 })).toBeNull();
    expect(hitTestPeakMarkers(markers, { x: 110, y: 50 }, 12)).toBe(0);
  });

  it("skips non-finite marker positions", () => {
    const markers = [
      { index: 0, x: NaN, y: 50 },
      { index: 1, x: 100, y: 50 },
    ];
    expect(hitTestPeakMarkers(markers, { x: 100, y: 50 })).toBe(1);
  });

  it("uses Euclidean (2-D) distance, not just x proximity", () => {
    // Same x as the pointer, but far away in y — outside a small tolerance.
    const markers = [{ index: 0, x: 100, y: 100 }];
    expect(hitTestPeakMarkers(markers, { x: 100, y: 50 }, 8)).toBeNull();
    expect(hitTestPeakMarkers(markers, { x: 100, y: 95 }, 8)).toBe(0);
  });
});
