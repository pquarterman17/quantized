import { describe, expect, it } from "vitest";

import { finiteExtent, isSinglePeakModel, sameRange, zoomedRange } from "./fitRange";

const x = finiteExtent([100, 400, 700, 1000, 1300, 1600, 1800]);

describe("zoomedRange (the fit range follows a zoom IN)", () => {
  it("is the visible X range when the limits cut the data", () => {
    expect(zoomedRange([450, 650], x)).toEqual({ lo: 450, hi: 650 });
    expect(zoomedRange([650, 450], x)).toEqual({ lo: 450, hi: 650 }); // a reversed axis
  });

  it("fills an open side from the data's end", () => {
    expect(zoomedRange([1200, null], x)).toEqual({ lo: 1200, hi: 1800 });
    expect(zoomedRange([null, 600], x)).toEqual({ lo: 100, hi: 600 });
  });

  it("clips a limit wider than the data on one side to the data", () => {
    expect(zoomedRange([0, 600], x)).toEqual({ lo: 100, hi: 600 });
  });

  it("is null when not zoomed, zoomed out past the data, or off the data", () => {
    expect(zoomedRange(null, x)).toBeNull();
    expect(zoomedRange([null, null], x)).toBeNull();
    expect(zoomedRange([0, 5000], x)).toBeNull();
    expect(zoomedRange([2000, 3000], x)).toBeNull();
    expect(zoomedRange([450, 650], null)).toBeNull();
  });
});

describe("helpers", () => {
  it("finiteExtent skips gaps", () => {
    expect(finiteExtent([null, 3, Number.NaN, -2, undefined])).toEqual([-2, 3]);
    expect(finiteExtent([1, 1])).toBeNull();
  });

  it("isSinglePeakModel: the registry's peak categories", () => {
    expect(isSinglePeakModel("Peak")).toBe(true);
    expect(isSinglePeakModel("Peak Functions")).toBe(true);
    expect(isSinglePeakModel("Linear")).toBe(false);
    expect(isSinglePeakModel(undefined)).toBe(false);
  });

  it("sameRange", () => {
    expect(sameRange(null, undefined)).toBe(true);
    expect(sameRange({ lo: 1, hi: 2 }, { lo: 1, hi: 2 })).toBe(true);
    expect(sameRange({ lo: 1, hi: 2 }, null)).toBe(false);
  });
});
