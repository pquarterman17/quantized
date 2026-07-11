// Peak-wizard domain logic only: the visible-marker projection and the
// center/height → gesture-point mapping. The generic hit-test cases that used
// to live here moved to pointGesture.test.ts with the shared core (MAIN #8).

import { describe, expect, it } from "vitest";

import { peakMarkerPixels, visiblePeakMarkers } from "./peakMarkerHit";

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
  it("maps center/height through valToPos as the core's (x, y) gesture points", () => {
    const u = { valToPos: (v: number) => v * 2 };
    const out = peakMarkerPixels(u, [{ index: 3, center: 10, height: 5 }]);
    expect(out).toEqual([{ index: 3, x: 10, y: 5, px: 20, py: 10 }]);
  });

  it("maps an empty marker list to an empty pixel list", () => {
    const u = { valToPos: (v: number) => v };
    expect(peakMarkerPixels(u, [])).toEqual([]);
  });
});
