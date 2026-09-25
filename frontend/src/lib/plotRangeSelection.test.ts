// The plot's selected x-range for "Peak Fitting ▸ Fit this range" (audit P2.4).

import { describe, expect, it } from "vitest";

import { plotRangeSelection, type PlotRangeInputs } from "./plotRangeSelection";

const base: PlotRangeInputs = { qfitRoi: null, integral: null, selection: null, activeId: "d1", plottedX: [10, 20, 30, 40, 50] };

describe("plotRangeSelection", () => {
  it("is null when nothing is selected", () => {
    expect(plotRangeSelection(base)).toBeNull();
  });

  it("reads the Gadget band first, ordered, over an integration region", () => {
    expect(plotRangeSelection({ ...base, qfitRoi: [44, 36], integral: { xlo: 1, xhi: 2 } }))
      .toEqual({ lo: 36, hi: 44, source: "gadget region" });
  });

  it("falls back to the ∫ region, then to the selected rows' x extent", () => {
    expect(plotRangeSelection({ ...base, integral: { xlo: 3, xhi: 7 } })).toEqual({ lo: 3, hi: 7, source: "integration region" });
    expect(plotRangeSelection({ ...base, selection: { datasetId: "d1", rows: [3, 1] } }))
      .toEqual({ lo: 20, hi: 40, source: "selected rows" });
  });

  it("ignores another dataset's row selection, degenerate ranges and non-finite x", () => {
    expect(plotRangeSelection({ ...base, selection: { datasetId: "d2", rows: [0, 4] } })).toBeNull();
    expect(plotRangeSelection({ ...base, selection: { datasetId: "d1", rows: [2] } })).toBeNull(); // one row: lo === hi
    expect(plotRangeSelection({ ...base, qfitRoi: [5, 5] })).toBeNull();
    expect(plotRangeSelection({ ...base, plottedX: [null, Number.NaN, 7], selection: { datasetId: "d1", rows: [0, 1, 2] } })).toBeNull();
  });
});
