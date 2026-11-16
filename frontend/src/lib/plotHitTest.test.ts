import { describe, expect, it } from "vitest";

import { axisZoneAt, nearestIndex, pickNearestSeries, type PlotRect } from "./plotHitTest";

const RECT: PlotRect = { left: 100, top: 100, right: 500, bottom: 400 };

describe("axisZoneAt", () => {
  it("reports the plot body when inside the rect", () => {
    expect(axisZoneAt(300, 250, RECT, false)).toBe("plot");
  });

  it("reports X below, Y to the left", () => {
    expect(axisZoneAt(300, 450, RECT, false)).toBe("x"); // below, x in range
    expect(axisZoneAt(50, 250, RECT, false)).toBe("y"); // left, y in range
  });

  it("reports Y2 to the right only when a secondary axis exists", () => {
    expect(axisZoneAt(560, 250, RECT, true)).toBe("y2");
    expect(axisZoneAt(560, 250, RECT, false)).toBe("outside");
  });

  it("reports outside for corners / far-off clicks", () => {
    expect(axisZoneAt(50, 50, RECT, true)).toBe("outside"); // top-left corner
    expect(axisZoneAt(300, 50, RECT, false)).toBe("outside"); // above the plot
  });
});

describe("nearestIndex", () => {
  it("finds the closest finite x sample", () => {
    const x = [0, 10, 20, 30, 40];
    expect(nearestIndex(x, 22)).toBe(2);
    expect(nearestIndex(x, 39)).toBe(4);
    expect(nearestIndex(x, -100)).toBe(0);
  });

  it("skips null / NaN samples and returns null for an empty column", () => {
    expect(nearestIndex([null, 5, null, 25], 24)).toBe(3);
    expect(nearestIndex([null, NaN], 1)).toBeNull();
    expect(nearestIndex([], 1)).toBeNull();
  });
});

describe("pickNearestSeries", () => {
  it("returns the display-series with the smallest pixel-y distance", () => {
    expect(pickNearestSeries(150, [150, 300])).toBe(0);
    expect(pickNearestSeries(290, [150, 300])).toBe(1);
  });

  it("skips null (hidden / no-sample) series", () => {
    expect(pickNearestSeries(160, [null, 155, null])).toBe(1);
    expect(pickNearestSeries(160, [null, null])).toBeNull();
  });

  it("rejects a nearest curve beyond maxDist", () => {
    expect(pickNearestSeries(0, [500, 600], 44)).toBeNull();
    expect(pickNearestSeries(480, [500, 600], 44)).toBe(0);
  });
});

describe("axisZoneAt on a TURNED plot (horizontal bars / Exchange X-Y)", () => {
  const rect = { left: 100, top: 50, right: 500, bottom: 350 };
  it("names the axis each gutter now carries: Y below, X at the left, Y2 across the top", () => {
    expect(axisZoneAt(300, 380, rect, true, true)).toBe("y");
    expect(axisZoneAt(60, 200, rect, true, true)).toBe("x");
    expect(axisZoneAt(300, 20, rect, true, true)).toBe("y2");
  });
  it("has no right gutter and no Y2 gutter without a Y2", () => {
    expect(axisZoneAt(540, 200, rect, true, true)).toBe("outside");
    expect(axisZoneAt(300, 20, rect, false, true)).toBe("outside");
  });
  it("leaves the upright answer alone", () => {
    expect(axisZoneAt(300, 380, rect, true)).toBe("x");
    expect(axisZoneAt(60, 200, rect, true)).toBe("y");
    expect(axisZoneAt(540, 200, rect, true)).toBe("y2");
  });
});
