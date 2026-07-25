import { describe, expect, it } from "vitest";

import type { CalcResult, Dataset } from "./types";
import { activeCorrectionNames, fitDataForSpec, fitSpecFrom, fitSpecFromStepParams, fitStepParams, fullPlottedX, selectedFitData, stampRecompute } from "./fitselection";

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
    // toMatchObject, not toEqual: MAIN #30 added range/nPoints/fittedAt to the
    // recipe, and this test is about the CHANNELS + result snapshot. Pinning
    // the exact key set here would make every future recipe field a failure in
    // a test that has no opinion about it — those fields have their own tests.
    expect(fitSpecFrom("Linear", 0, sel, result)).toMatchObject({
      model: "Linear",
      xKey: 0,
      yKey: 1,
      params: [2, 0.5],
      exitFlag: 1,
    });
  });

  it("omits a non-numeric params/exitFlag snapshot", () => {
    const sel = { x: [1], y: [2], yKey: 0 };
    const spec = fitSpecFrom("Gauss", null, sel, { params: "bad" } as CalcResult);
    expect(spec).toMatchObject({ model: "Gauss", xKey: null, yKey: 0 });
    // The point of this test: a non-numeric snapshot is DROPPED, not stored.
    expect(spec.params).toBeUndefined();
    expect(spec.exitFlag).toBeUndefined();
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

describe("fitStepParams / fitSpecFromStepParams (pipeline fit-step recipe #6)", () => {
  it("encodes channels + non-none weighting, never the result snapshot", () => {
    const spec = fitSpecFrom(
      "Gaussian",
      0,
      { x: [1], y: [2], yKey: 1 },
      { params: [1, 2, 3], exitFlag: 1 },
      { mode: "yerr", errKey: 2 },
    );
    expect(fitStepParams("Gaussian", spec)).toEqual({
      model: "Gaussian",
      xKey: 0,
      yKey: 1,
      weight: { mode: "yerr", errKey: 2 },
    });
  });

  it("omits weight when mode is none and round-trips a null xKey (time axis)", () => {
    const spec = fitSpecFrom("Linear", null, { x: [1], y: [2], yKey: 0 }, { params: [1] });
    const params = fitStepParams("Linear", spec);
    expect(params).toEqual({ model: "Linear", xKey: null, yKey: 0 });
    expect(fitSpecFromStepParams(params)).toEqual({ model: "Linear", xKey: null, yKey: 0 });
  });

  it("decodes a legacy {model}-only step to a channel-less recipe", () => {
    // No yKey -> executor keeps time/values[0] (legacy behavior).
    expect(fitSpecFromStepParams({ model: "Linear" })).toEqual({ model: "Linear" });
  });

  it("defends against malformed params (non-string model, junk channels/weight)", () => {
    expect(fitSpecFromStepParams({})).toEqual({ model: "Linear" }); // model default
    // yKey present but xKey junk -> xKey coerced to null (time axis).
    expect(fitSpecFromStepParams({ model: "Linear", yKey: 1, xKey: "0" })).toEqual({
      model: "Linear",
      yKey: 1,
      xKey: null,
    });
    // non-integer yKey is rejected -> legacy recipe.
    expect(fitSpecFromStepParams({ model: "Linear", yKey: 1.5 })).toEqual({ model: "Linear" });
    // a `none` / malformed weight is dropped.
    expect(
      fitSpecFromStepParams({ model: "Linear", yKey: 0, xKey: 0, weight: { mode: "none" } }).weight,
    ).toBeUndefined();
    expect(
      fitSpecFromStepParams({ model: "Linear", yKey: 0, xKey: 0, weight: { mode: "bogus" } }).weight,
    ).toBeUndefined();
  });
});

describe("fit recipe residual fields (MAIN #30)", () => {
  const sel = { x: [1, 2, 3, 4], y: [1, 2, 3, 4], yKey: 0 };
  const result = { params: [1, 2], exitFlag: 1 };
  const at = () => "2026-07-25T12:00:00.000Z";

  it("records the x-WINDOW the fit consumed, not just the channels", () => {
    // Without it a recipe says which channels were fit but not which part of
    // them: "fit the peak" and "fit the whole scan" look identical.
    const spec = fitSpecFrom("gauss", null, sel, result, undefined, undefined, at);
    expect(spec.range).toEqual([1, 4]);
    expect(spec.nPoints).toBe(4);
  });

  it("ignores non-finite x when computing the range", () => {
    const gappy = { x: [NaN, 2, Infinity, 5], y: [1, 2, 3, 4], yKey: 0 };
    expect(fitSpecFrom("g", null, gappy, result, undefined, undefined, at).range).toEqual([2, 5]);
  });

  it("omits the range when nothing is finite", () => {
    const bad = { x: [NaN, NaN], y: [1, 2], yKey: 0 };
    const spec = fitSpecFrom("g", null, bad, result, undefined, undefined, at);
    expect(spec.range).toBeUndefined();
    expect(spec.nPoints).toBeUndefined();
  });

  it("stamps when the fit was produced", () => {
    expect(fitSpecFrom("g", null, sel, result, undefined, undefined, at).fittedAt).toBe(at());
  });

  it("records which corrections the source carried", () => {
    const spec = fitSpecFrom("g", null, sel, result, undefined, ["smoothEnabled"], at);
    expect(spec.preprocessing).toEqual(["smoothEnabled"]);
  });

  it("omits preprocessing when nothing was applied", () => {
    expect(fitSpecFrom("g", null, sel, result, undefined, [], at).preprocessing).toBeUndefined();
  });
});

describe("activeCorrectionNames (MAIN #30)", () => {
  it("names only the corrections that are actually on", () => {
    expect(
      activeCorrectionNames({ xOff: 0, yOff: 2, smoothEnabled: true, normMethod: "None" }),
    ).toEqual(["smoothEnabled", "yOff"]);
  });

  it("is empty for no corrections", () => {
    expect(activeCorrectionNames(undefined)).toEqual([]);
    expect(activeCorrectionNames({})).toEqual([]);
  });

  it("records names, never values — a second copy of the params would drift", () => {
    const names = activeCorrectionNames({ yOff: 12345 });
    expect(names).toEqual(["yOff"]);
    expect(JSON.stringify(names)).not.toContain("12345");
  });

  it("skips empty arrays and blank strings", () => {
    expect(activeCorrectionNames({ bgPoly: [], smoothMethod: "" })).toEqual([]);
  });
});

describe("stampRecompute (MAIN #30)", () => {
  const now = () => "2026-07-25T13:00:00.000Z";

  it("marks the result as regenerated, not original", () => {
    const spec = { model: "g", fittedAt: "2026-07-25T12:00:00.000Z" };
    expect(stampRecompute(spec, { params: [9] }, now).recomputedAt).toBe(now());
  });

  it("refreshes the params ALONGSIDE the stamp", () => {
    // Leaving the old numbers beside a fresh timestamp would claim a re-run
    // while showing what the previous run produced.
    const spec = { model: "g", params: [1, 2] };
    expect(stampRecompute(spec, { params: [7, 8] }, now).params).toEqual([7, 8]);
  });

  it("keeps the original fittedAt, so both times are readable", () => {
    const spec = { model: "g", fittedAt: "orig" };
    expect(stampRecompute(spec, {}, now).fittedAt).toBe("orig");
  });

  it("leaves params alone when the recompute returned none", () => {
    const spec = { model: "g", params: [1] };
    expect(stampRecompute(spec, {}, now).params).toEqual([1]);
  });
});
