// The plot's selected x-range for "Peak Fitting ▸ Fit this range" (audit P2.4).

import { describe, expect, it, vi } from "vitest";

import { plotRangeSelection, type PlotRangeInputs, type RegionContext } from "./plotRangeSelection";

const here: RegionContext = { datasetId: "d1", xKey: null };
const base: PlotRangeInputs = {
  qfitRoi: null, qfitRoiFor: null, integral: null, selection: null, activeId: "d1", xKey: null,
  plottedX: () => [10, 20, 30, 40, 50],
};
const integral = (xlo: number, xhi: number, context = here) => ({ xlo, xhi, area: 1, context });

describe("plotRangeSelection", () => {
  it("is null when nothing is selected", () => {
    expect(plotRangeSelection(base)).toBeNull();
  });

  it("reads the Gadget band first, ordered, over an integration region", () => {
    expect(plotRangeSelection({ ...base, qfitRoi: [44, 36], qfitRoiFor: here, integral: integral(1, 2) }))
      .toEqual({ lo: 36, hi: 44, source: "gadget region" });
  });

  it("falls back to the ∫ region, then to the selected rows' x extent", () => {
    expect(plotRangeSelection({ ...base, integral: integral(3, 7) })).toEqual({ lo: 3, hi: 7, source: "integration region" });
    expect(plotRangeSelection({ ...base, selection: { datasetId: "d1", rows: [3, 1] } }))
      .toEqual({ lo: 20, hi: 40, source: "selected rows" });
  });

  it("ignores a band or ∫ region drawn on another dataset or X column, or never stamped (review #6)", () => {
    const roi = { qfitRoi: [36, 44] as [number, number] };
    expect(plotRangeSelection({ ...base, ...roi, qfitRoiFor: { datasetId: "d2", xKey: null } })).toBeNull();
    expect(plotRangeSelection({ ...base, ...roi, qfitRoiFor: here, xKey: 2 })).toBeNull(); // X column switched
    expect(plotRangeSelection({ ...base, ...roi, qfitRoiFor: null })).toBeNull();
    expect(plotRangeSelection({ ...base, integral: integral(3, 7, { datasetId: "d1", xKey: 1 }) })).toBeNull();
    expect(plotRangeSelection({ ...base, integral: { xlo: 3, xhi: 7, area: 1 } })).toBeNull();
    expect(plotRangeSelection({ ...base, activeId: "d2", integral: integral(3, 7) })).toBeNull();
  });

  it("builds the plotted X column only when the row selection decides (review #8)", () => {
    const plottedX = vi.fn(() => [10, 20, 30]);
    expect(plotRangeSelection({ ...base, plottedX, integral: integral(3, 7), selection: { datasetId: "d1", rows: [0, 2] } }))
      .toMatchObject({ source: "integration region" });
    expect(plottedX).not.toHaveBeenCalled();
    expect(plotRangeSelection({ ...base, plottedX, selection: { datasetId: "d1", rows: [0, 2] } })).toMatchObject({ lo: 10, hi: 30 });
    expect(plottedX).toHaveBeenCalledTimes(1);
  });

  it("ignores another dataset's row selection, degenerate ranges and non-finite x", () => {
    expect(plotRangeSelection({ ...base, selection: { datasetId: "d2", rows: [0, 4] } })).toBeNull();
    expect(plotRangeSelection({ ...base, selection: { datasetId: "d1", rows: [2] } })).toBeNull(); // one row: lo === hi
    expect(plotRangeSelection({ ...base, qfitRoi: [5, 5], qfitRoiFor: here })).toBeNull();
    expect(plotRangeSelection({ ...base, plottedX: () => [null, Number.NaN, 7], selection: { datasetId: "d1", rows: [0, 1, 2] } })).toBeNull();
  });
});
