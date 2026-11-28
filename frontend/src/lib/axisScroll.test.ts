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
    expect(scrollFraction([10, 100], extent, "log")).toBeCloseTo(1 / 3, 12);
    const w = scrolledWindow([10, 100], extent, 0.5, "log");
    expect(w[0]).toBeCloseTo(10 ** 1.5, 9);
    expect(w[1]).toBeCloseTo(10 ** 2.5, 9);
    expect(Math.log10(w[1]) - Math.log10(w[0])).toBeCloseTo(1, 12);
  });
  it("never produces a non-positive limit, at any slider position, even a wild one", () => {
    for (const t of [-100, -1, 0, 1e-9, 0.25, 0.5, 0.999, 1, 7, NaN]) {
      const w = scrolledWindow([2e-3, 5e-2], [1e-6, 1e3], t, "log");
      expect(w[0]).toBeGreaterThan(0);
      expect(w[1]).toBeGreaterThan(0);
      expect(w[0]).toBeGreaterThanOrEqual(1e-6 * (1 - 1e-12));
      expect(w[1]).toBeLessThanOrEqual(1e3 * (1 + 1e-12));
    }
  });
  it("leaves a window or extent at or below zero alone (no log to scroll in)", () => {
    expect(scrolledWindow([-1, 5], [1, 100], 0.5, "log")).toEqual([-1, 5]);
    expect(scrolledWindow([2, 5], [0, 100], 0.5, "log")).toEqual([2, 5]);
    expect(scrollFraction([0, 5], [1, 100], "log")).toBeNull();
  });
  it("keeps a reversed log axis reversed", () => {
    const w = scrolledWindow([100, 10], [1, 10000], 0, "log");
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

// A reciprocal axis scrolls in 1/x space (Origin's rule). The slider still reads left = low X,
// because the axis draws low X on the left. Hand-computed: extent [1, 10] is [0.1, 1] in 1/x.
describe("reciprocal axes", () => {
  const extent = [1, 10] as const;
  it("moves the window by equal steps of 1/x, not of x", () => {
    // [2, 4] is [0.25, 0.5] in 1/x: width 0.25, free room 0.9 - 0.25 = 0.65, its low end 0.15 above the extent's.
    expect(scrollFraction([2, 4], extent, "reciprocal")).toBeCloseTo(1 - 0.15 / 0.65, 12);
    const first = scrolledWindow([2, 4], extent, 0, "reciprocal"); // slider at the left: the lowest X
    expect(first[0]).toBeCloseTo(1, 12);
    expect(first[1]).toBeCloseTo(4 / 3, 12); // 1/(1 - 0.25) = 4/3
    const last = scrolledWindow([2, 4], extent, 1, "reciprocal");
    expect(last[0]).toBeCloseTo(20 / 7, 12); // 1/(0.1 + 0.25)
    expect(last[1]).toBeCloseTo(10, 12);
    const mid = scrolledWindow([2, 4], extent, 0.5, "reciprocal"); // 1/x window [0.25+..]: halfway through the 0.65 room
    expect(1 / mid[0] - 1 / mid[1]).toBeCloseTo(0.25, 12); // the width in 1/x is kept
    expect(1 / mid[1]).toBeCloseTo(0.1 + 0.325, 12);
  });
  it("round-trips and never leaves the extent or goes non-positive", () => {
    const t = scrollFraction([2, 4], extent, "reciprocal")!;
    const w = scrolledWindow([2, 4], extent, t, "reciprocal");
    expect(w[0]).toBeCloseTo(2, 12);
    expect(w[1]).toBeCloseTo(4, 12);
    for (const at of [-5, 0, 1e-9, 0.3, 0.999, 1, 9, NaN]) {
      const v = scrolledWindow([2, 4], extent, at, "reciprocal");
      expect(v[0]).toBeGreaterThanOrEqual(1 - 1e-12);
      expect(v[1]).toBeLessThanOrEqual(10 + 1e-12);
      expect(v[0]).toBeLessThan(v[1]);
    }
  });
  it("moves right as the slider moves right, and keeps a reversed axis reversed", () => {
    const [a, b] = [scrolledWindow([2, 4], extent, 0.2, "reciprocal"), scrolledWindow([2, 4], extent, 0.8, "reciprocal")];
    expect(b[0]).toBeGreaterThan(a[0]);
    const rev = scrolledWindow([4, 2], extent, 0, "reciprocal");
    expect(rev[0]).toBeGreaterThan(rev[1]);
    expect(rev[1]).toBeCloseTo(1, 12);
  });
  it("leaves a window or extent at or below zero alone", () => {
    expect(scrolledWindow([-1, 5], extent, 0.5, "reciprocal")).toEqual([-1, 5]);
    expect(scrolledWindow([2, 5], [0, 10], 0.5, "reciprocal")).toEqual([2, 5]);
    expect(scrollFraction([2, 5], [0, 10], "reciprocal")).toBeNull();
  });
  it("counts only positive points where an axis needs them", () => {
    const d: Dataset = { id: "r", name: "R", data: { time: [-1, 0, 2, 5], values: [[1], [2], [3], [4]], labels: ["Y"], units: [""], metadata: {} } };
    expect(dataExtents(d, null, [0], null, [], [], { x: true }).x).toEqual([2, 5]);
  });
});

// The Y2 axis has its own extent: the curves drawn on it, and the X axis spans every visible curve.
describe("Y2 extents", () => {
  const two: Dataset = {
    id: "t", name: "T",
    data: { time: [0, 1, 2, 3], values: [[1, 100], [2, 200], [3, 400], [4, 800]], labels: ["P", "Q"], units: ["", ""], metadata: {} },
  };
  it("gives the primary Y the primary curves and the Y2 the others", () => {
    expect(dataExtents(two, null, [0, 1], null, [], [1]).y).toEqual([1, 4]);
    expect(dataExtents(two, null, [0, 1], null, [], [1], {}, "y2").y).toEqual([100, 800]);
  });
  it("lets only a log or reciprocal Y2 drop its non-positive points", () => {
    const neg: Dataset = { ...two, data: { ...two.data, values: [[1, -5], [2, 200], [3, 400], [4, 800]] } };
    expect(dataExtents(neg, null, [0, 1], null, [], [1], {}, "y2").y).toEqual([-5, 800]);
    expect(dataExtents(neg, null, [0, 1], null, [], [1], { y2: true }, "y2").y).toEqual([200, 800]);
  });
  it("spans the X of a curve that is only on Y2", () => {
    const only: Dataset = { ...two, data: { ...two.data, time: [0, 10, 20, 30], values: [[1, 7], [2, 8], [3, 9], [4, 10]] } };
    expect(dataExtents(only, null, [1], null, [], [1], {}, "y2")).toEqual({ x: [0, 30], y: [7, 10] });
  });
});

describe("probability axes scroll in quantiles, extra axes in their own extent (item 22)", () => {
  // scipy.stats.norm.ppf([0.01, 0.99, 0.4, 0.6]) = -2.32634787, 2.32634787, -0.2533471, 0.2533471
  it("a fraction axis keeps its width in probit space: the ends are 0.01..0.0344059 and 0.9655941..0.99", () => {
    const extent: [number, number] = [0.01, 0.99];
    const lo = scrolledWindow([0.4, 0.6], extent, 0, "prob");
    expect(lo[0]).toBeCloseTo(0.01, 12);
    expect(lo[1]).toBeCloseTo(0.03440588162805031, 12);
    const hi = scrolledWindow([0.4, 0.6], extent, 1, "prob");
    expect(hi[0]).toBeCloseTo(0.9655941183719496, 12);
    expect(hi[1]).toBeCloseTo(0.99, 12);
    expect(scrollFraction([0.4, 0.6], extent, "prob")).toBeCloseTo(0.5, 12); // the window is centred
    expect(scrolledWindow([0.4, 0.6], extent, 0.5, "prob")[0]).toBeCloseTo(0.4, 12);
  });

  it("a percent axis is the same space; a window outside (0, 100) is left alone", () => {
    const w = scrolledWindow([40, 60], [1, 99], 0, "probPct");
    expect(w[0]).toBeCloseTo(1, 10);
    expect(w[1]).toBeCloseTo(3.440588162805031, 10);
    expect(scrolledWindow([0, 60], [1, 99], 0.5, "probPct")).toEqual([0, 60]);
    expect(scrollFraction([0.4, 1.2], [0.01, 0.99], "prob")).toBeNull();
  });

  it("the extent counts only values a probability axis can draw", () => {
    const ds = { id: "p", name: "p", data: { time: [0, 1, 2, 3, 4], values: [[0], [0.2], [0.5], [1], [0.9]], labels: ["P"], units: [""], metadata: {} } };
    const e = dataExtents(ds, null, [0], null, [], [], { y: "fraction" });
    expect(e.y).toEqual([0.2, 0.9]); // 0 and 1 are on the axis' edge, not on it
    expect(e.x).toEqual([1, 4]);
  });

  it("a Y3 axis spans only the curves drawn on it", () => {
    const ds = { id: "q", name: "q", data: { time: [1, 2, 3], values: [[1, 100, 7], [2, 200, 8], [3, 300, 9]], labels: ["A", "B", "C"], units: ["", "", ""], metadata: {} } };
    const of = { 1: 3 };
    expect(dataExtents(ds, null, [0, 1, 2], null, [], [], {}, 3, of).y).toEqual([100, 300]);
    expect(dataExtents(ds, null, [0, 1, 2], null, [], [], {}, "primary", of).y).toEqual([1, 9]);
  });
});
