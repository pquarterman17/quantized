import { describe, expect, it } from "vitest";

import type { CalcResult, Dataset } from "./types";
import { fitDataForSpec, fitSpecFrom, fullPlottedX, selectedFitData } from "./fitselection";

const dataset: Dataset = {
  id: "d",
  name: "multi.dat",
  data: {
    time: [0, 1, 2, 3],
    values: [[100, 10, 5], [200, 20, 6], [300, 30, 7], [400, 40, 8]],
    labels: ["field", "moment", "aux"],
    units: ["Oe", "emu", ""],
    metadata: {},
  },
  excludedRows: [1],
};

describe("selectedFitData", () => {
  it("uses the plot X and first effective Y after series ordering", () => {
    expect(selectedFitData(dataset, 0, [2, 1], [1, 2])).toEqual({
      x: [100, 300, 400],
      y: [10, 30, 40],
      yKey: 1,
    });
  });

  it("does not select an ignored or X-role channel as Y", () => {
    const roled = { ...dataset, channelRoles: { 1: "ignore" as const } };
    expect(selectedFitData(roled, 0, [0, 1, 2], null)?.yKey).toBe(2);
  });
});

describe("fullPlottedX", () => {
  it("returns the xKey channel's FULL column, or time when null/out-of-range", () => {
    expect(fullPlottedX(dataset.data, 0)).toEqual([100, 200, 300, 400]); // full, not pruned
    expect(fullPlottedX(dataset.data, null)).toEqual([0, 1, 2, 3]); // time
    expect(fullPlottedX(dataset.data, 9)).toEqual([0, 1, 2, 3]); // out-of-range -> time
  });
});

describe("fitSpecFrom (provenance recipe, audit P1 #3)", () => {
  it("records the model, plotted channels, and result snapshot", () => {
    const sel = { x: [100, 200], y: [10, 20], yKey: 1 };
    const result: CalcResult = { params: [2, 0.5], exitFlag: 1, R2: 0.99 };
    expect(fitSpecFrom("Linear", 0, sel, result)).toEqual({
      model: "Linear",
      xKey: 0,
      yKey: 1,
      params: [2, 0.5],
      exitFlag: 1,
    });
  });

  it("omits a non-numeric params/exitFlag snapshot", () => {
    const sel = { x: [1], y: [2], yKey: 0 };
    expect(fitSpecFrom("Gauss", null, sel, { params: "bad" } as CalcResult)).toEqual({
      model: "Gauss",
      xKey: null,
      yKey: 0,
    });
  });

  it("records a non-none weighting choice and omits `none`", () => {
    const sel = { x: [1], y: [2], yKey: 1 };
    const result: CalcResult = { params: [1], exitFlag: 1 };
    expect(fitSpecFrom("Linear", 0, sel, result, { mode: "yerr", errKey: 2 }).weight).toEqual({
      mode: "yerr",
      errKey: 2,
    });
    expect(fitSpecFrom("Linear", 0, sel, result, { mode: "none" }).weight).toBeUndefined();
  });
});

describe("fitDataForSpec (recompute reproduces the recorded channels)", () => {
  it("reproduces the spec's stored channels over the analysis rows", () => {
    // spec fit field(0) vs moment(1); row 1 excluded. Ignores the live plot
    // selection passed alongside (aux(2) vs time) — provenance wins.
    const sel = fitDataForSpec(dataset, { model: "Linear", xKey: 0, yKey: 1 }, null, [2], null);
    expect(sel).toEqual({ x: [100, 300, 400], y: [10, 30, 40], yKey: 1 });
  });

  it("falls back to the live plotted selection for a legacy {model} spec", () => {
    // No xKey/yKey recorded -> use the live selection (xKey 0, yKeys [2]).
    const sel = fitDataForSpec(dataset, { model: "Linear" }, 0, [2], null);
    expect(sel).toEqual({ x: [100, 300, 400], y: [5, 7, 8], yKey: 2 });
  });

  it("falls back to live when a stored channel no longer exists (columns changed)", () => {
    const sel = fitDataForSpec(dataset, { model: "Linear", xKey: 0, yKey: 9 }, 0, [1], null);
    expect(sel?.yKey).toBe(1); // out-of-range yKey 9 -> live selection (moment)
  });

  it("reproduces the recorded weighting as dy over the analysis rows", () => {
    // aux(2) is the sigma column; row 1 excluded -> dy = abs([5, 7, 8]).
    const spec = { model: "Linear", xKey: 0, yKey: 1, weight: { mode: "yerr" as const, errKey: 2 } };
    expect(fitDataForSpec(dataset, spec, null, null, null)).toEqual({
      x: [100, 300, 400],
      y: [10, 30, 40],
      yKey: 1,
      dy: [5, 7, 8],
    });
  });
});
