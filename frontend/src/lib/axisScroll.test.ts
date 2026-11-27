// Item 22: the axis scroller's model: extents through the row-state model,
// the slider <-> window mapping, clamping and reversed axes.

import { describe, expect, it } from "vitest";

import { endAxisScroll, scrollAxisTo } from "../store/graphBrowserActions";
import { useApp } from "../store/useApp";

import { dataExtents, scrollFraction, scrolledWindow } from "./axisScroll";
import type { Dataset } from "./types";

const ds = (excluded?: number[]): Dataset => ({
  id: "a",
  name: "A",
  data: { time: [0, 1, 2, 3, 4], values: [[10], [20], [30], [40], [1000]], labels: ["Y"], units: [""], metadata: {} },
  ...(excluded ? { excludedRows: excluded } : {}),
});

describe("dataExtents", () => {
  it("spans the plotted rows", () => {
    expect(dataExtents(ds(), null, [0], null, [], [])).toEqual({ x: [0, 4], y: [10, 1000] });
  });
  it("leaves out an excluded row (row-state model), so the scroller spans what is drawn", () => {
    expect(dataExtents(ds([4]), null, [0], null, [], [])).toEqual({ x: [0, 3], y: [10, 40] });
  });
  it("has no extent when every curve is hidden", () => {
    expect(dataExtents(ds(), null, [0], null, [0], [])).toEqual({ x: null, y: null });
  });
});

describe("scroll mapping", () => {
  it("round-trips and clamps", () => {
    const extent = [0, 10] as const;
    expect(scrollFraction([2, 4], extent)).toBeCloseTo(0.25);
    expect(scrolledWindow([2, 4], extent, 0.25)).toEqual([2, 4]);
    expect(scrolledWindow([2, 4], extent, 1)).toEqual([8, 10]);
    expect(scrolledWindow([2, 4], extent, -3)).toEqual([0, 2]);
  });
  it("keeps a reversed axis reversed and its width", () => {
    expect(scrolledWindow([4, 2], [0, 10], 0)).toEqual([2, 0]);
  });
  it("has nothing to scroll when the window covers the data", () => {
    expect(scrollFraction([-1, 11], [0, 10])).toBeNull();
    expect(scrollFraction([0, 10], [0, 10])).toBeNull();
  });
});

// A log axis scrolls in log10 space and can never be handed a limit at or below zero.
describe("log axes", () => {
  const logDs: Dataset = {
    id: "l", name: "L",
    data: { time: [-5, 0, 1, 10, 100, 10000], values: [[3], [4], [0], [-2], [50], [7]], labels: ["Y"], units: [""], metadata: {} },
  };
  it("counts only the points a log axis can draw (positive on that axis, finite on both)", () => {
    // Rows 0,1 have x <= 0; row 2 has y = 0; row 3 has y < 0: only rows 4, 5 remain on a log-log plot.
    expect(dataExtents(logDs, null, [0], null, [], [], { x: true, y: true })).toEqual({ x: [100, 10000], y: [7, 50] });
    expect(dataExtents(logDs, null, [0], null, [], [], { y: true }).x).toEqual([-5, 10000]); // a linear X keeps its negative values
  });
  it("maps the slider in log10: the window keeps its width in decades", () => {
    const extent = [1, 10000] as const; // 4 decades
    expect(scrollFraction([10, 100], extent, true)).toBeCloseTo(1 / 3, 12);
    const w = scrolledWindow([10, 100], extent, 0.5, true);
    expect(w[0]).toBeCloseTo(10 ** 1.5, 9);
    expect(w[1]).toBeCloseTo(10 ** 2.5, 9);
    expect(Math.log10(w[1]) - Math.log10(w[0])).toBeCloseTo(1, 12);
  });
  it("never produces a non-positive limit, at any slider position, even a wild one", () => {
    for (const t of [-100, -1, 0, 1e-9, 0.25, 0.5, 0.999, 1, 7, NaN]) {
      const w = scrolledWindow([2e-3, 5e-2], [1e-6, 1e3], t, true);
      expect(w[0]).toBeGreaterThan(0);
      expect(w[1]).toBeGreaterThan(0);
      expect(w[0]).toBeGreaterThanOrEqual(1e-6 * (1 - 1e-12));
      expect(w[1]).toBeLessThanOrEqual(1e3 * (1 + 1e-12));
    }
  });
  it("leaves a window or extent at or below zero alone (no log to scroll in)", () => {
    expect(scrolledWindow([-1, 5], [1, 100], 0.5, true)).toEqual([-1, 5]);
    expect(scrolledWindow([2, 5], [0, 100], 0.5, true)).toEqual([2, 5]);
    expect(scrollFraction([0, 5], [1, 100], true)).toBeNull();
  });
  it("keeps a reversed log axis reversed", () => {
    const w = scrolledWindow([100, 10], [1, 10000], 0, true);
    expect(w[0]).toBeGreaterThan(w[1]);
    expect(w[1]).toBeCloseTo(1, 9);
    expect(w[0]).toBeCloseTo(10, 9);
  });
  it("scrolls through the real store on a log axis, as one Back-view step", () => {
    useApp.setState({ xScale: "log", yScale: "linear", xLim: [10, 100], yLim: [null, null] });
    scrollAxisTo("x", [1, 10000], 0.5);
    const lim = useApp.getState().xLim as [number, number];
    expect(lim[0]).toBeCloseTo(10 ** 1.5, 9);
    expect(lim[1]).toBeCloseTo(10 ** 2.5, 9);
    scrollAxisTo("x", [1, 10000], 0);
    expect(useApp.getState().xLim as [number, number]).toEqual([1, 10]);
    useApp.setState({ viewHistory: [], viewFuture: [] });
    endAxisScroll();
    expect(useApp.getState().viewHistory).toHaveLength(1);
    useApp.setState({ xScale: "linear", xLim: [null, null] });
  });
});
