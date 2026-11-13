import { describe, expect, it } from "vitest";

import type { Dataset } from "./types";
import { parseFitSpec } from "./fitSpecParse";
import { fitSpecFromStepParams } from "./fitStepDecode";
import { fitStatsLabels, statsVersionField } from "./fitStatsVersion";
import { fitStepParams } from "./fitStepParams";
import { stampRecompute } from "./fitRecompute";
import { dyForFit, scaleErrorsField, weightRequestFields } from "./fitweights";

// field, moment, err(good), bad(has non-positive). Row 1 excluded, so every
// resolved dy is aligned to the analysis rows [0, 2, 3] — same pruning the fit
// consumes (selectedFitData).
const dataset: Dataset = {
  id: "d",
  name: "m.dat",
  data: {
    time: [0, 1, 2, 3],
    values: [
      [100, 10, 2, 0],
      [200, 20, 9, 9],
      [300, 30, 3, -1],
      [400, 40, 4, 5],
    ],
    labels: ["field", "moment", "err", "bad"],
    units: ["Oe", "emu", "emu", ""],
    metadata: {},
  },
  excludedRows: [1],
};

describe("dyForFit", () => {
  it("returns null (unweighted) for mode none", () => {
    expect(dyForFit(dataset, 1, { mode: "none" })).toEqual({ dy: null });
  });

  it("poisson uses sqrt(max(|y|,1)) over the analysis rows", () => {
    const { dy } = dyForFit(dataset, 1, { mode: "poisson" });
    expect(dy).toEqual([Math.sqrt(10), Math.sqrt(30), Math.sqrt(40)]);
  });

  it("poisson floors sigma at 1 so a zero count stays > 0", () => {
    // yKey 3 (bad) has values [0, (excl), -1, 5] -> analysis [0, -1, 5]
    const { dy } = dyForFit(dataset, 3, { mode: "poisson" });
    expect(dy).toEqual([1, 1, Math.sqrt(5)]); // sqrt(max(0,1))=1, sqrt(max(1,1))=1
  });

  it("yerr reads the abs of the designated error column, row-aligned", () => {
    const { dy, issue } = dyForFit(dataset, 1, { mode: "yerr", errKey: 2 });
    expect(dy).toEqual([2, 3, 4]);
    expect(issue).toBeUndefined();
  });

  it("yerr with no designated column reports an issue and stays unweighted", () => {
    const r = dyForFit(dataset, 1, { mode: "yerr" });
    expect(r.dy).toBeNull();
    expect(r.issue).toMatch(/no error column/);
  });

  it("manual uses the picked column; rejects a non-positive column", () => {
    expect(dyForFit(dataset, 1, { mode: "manual", errKey: 2 }).dy).toEqual([2, 3, 4]);
    const bad = dyForFit(dataset, 1, { mode: "manual", errKey: 3 }); // [0, -1, 5]
    expect(bad.dy).toBeNull();
    expect(bad.issue).toMatch(/non-positive|invalid/);
  });

  it("validates dy only over the rows the fit keeps (a gap row's bad sigma is irrelevant)", () => {
    // Analysis rows [0, 2, 3]; errKey 3 = [0, -1, 5]. Keeping only analysis
    // rows 2 (its sigma is 5) must weight, not refuse over rows the fit drops.
    const r = dyForFit(dataset, 1, { mode: "manual", errKey: 3 }, [2]);
    expect(r.issue).toBeUndefined();
    expect(r.dy?.[2]).toBe(5);
    // A bad sigma on a KEPT row still refuses.
    expect(dyForFit(dataset, 1, { mode: "manual", errKey: 3 }, [0, 2]).dy).toBeNull();
  });

  it("rejects an out-of-range error column", () => {
    expect(dyForFit(dataset, 1, { mode: "manual", errKey: 9 }).dy).toBeNull();
  });
});

describe("scale-errors switch (fitting audit #12)", () => {
  it("adds scale_errors: false only for a weighted fit that turned scaling off", () => {
    expect(scaleErrorsField(undefined)).toEqual({});
    expect(scaleErrorsField({ mode: "yerr", errKey: 2 })).toEqual({});
    expect(scaleErrorsField({ mode: "yerr", errKey: 2, scaleErrors: false })).toEqual({ scale_errors: false });
    expect(scaleErrorsField({ mode: "none", scaleErrors: false })).toEqual({});
  });

  it("round-trips through a saved fit spec and a recorded pipeline step", () => {
    const weight = { mode: "manual", errKey: 2, scaleErrors: false };
    expect(parseFitSpec({ model: "Linear", weight })?.weight).toEqual(weight);
    expect(fitSpecFromStepParams({ model: "Linear", yKey: 0, weight }).weight).toEqual(weight);
    // Anything but an explicit false is the default (scaled) and is not stored.
    expect(parseFitSpec({ model: "Linear", weight: { mode: "poisson", scaleErrors: "no" } })?.weight)
      .toEqual({ mode: "poisson" });
  });
});

describe("direct weighting (review item 11)", () => {
  it("reads the weight column AS IS — zero allowed, never abs'd", () => {
    const withWeights: Dataset = {
      ...dataset,
      data: { ...dataset.data, values: [[100, 10, 2, 0], [200, 20, 9, 9], [300, 30, 3, 0.5], [400, 40, 4, 5]] },
    };
    expect(dyForFit(withWeights, 1, { mode: "direct", errKey: 3 })).toEqual({ dy: [0, 0.5, 5] });
  });

  it("refuses a negative weight, an all-zero column, or no column — and says so", () => {
    expect(dyForFit(dataset, 1, { mode: "direct", errKey: 3 })).toEqual({
      dy: null,
      issue: "the weight column has negative or invalid values (or is all zero) — fitting unweighted",
    });
    const zeros: Dataset = {
      ...dataset,
      data: { ...dataset.data, values: dataset.data.values.map((row) => [row[0], row[1], row[2], 0]) },
    };
    expect(dyForFit(zeros, 1, { mode: "direct", errKey: 3 }).dy).toBeNull();
    expect(dyForFit(dataset, 1, { mode: "direct" }).issue).toBe("pick a column of weights — fitting unweighted");
  });

  it("goes on the wire as `weights`; the error modes as `dy`", () => {
    expect(weightRequestFields({ mode: "direct", errKey: 3 }, [1, 2])).toEqual({ weights: [1, 2] });
    expect(weightRequestFields({ mode: "direct", errKey: 3, scaleErrors: false }, [1, 2]))
      .toEqual({ weights: [1, 2], scale_errors: false });
    expect(weightRequestFields({ mode: "yerr", errKey: 2 }, [1, 2])).toEqual({ dy: [1, 2] });
  });

  it("round-trips through a saved fit spec and a pipeline step", () => {
    const weight = { mode: "direct", errKey: 3 };
    expect(parseFitSpec({ model: "Linear", weight })?.weight).toEqual(weight);
    expect(fitSpecFromStepParams({ model: "Linear", yKey: 0, weight }).weight).toEqual(weight);
  });
});

describe("statistics version of a saved fit (review item 10)", () => {
  it("is kept by the spec parser, the step encoder and the step decoder; absent = legacy", () => {
    expect(parseFitSpec({ model: "Linear", statsVersion: 2 })?.statsVersion).toBe(2);
    expect(parseFitSpec({ model: "Linear", statsVersion: 3 })?.statsVersion).toBeUndefined();
    expect(parseFitSpec({ model: "Linear" })?.statsVersion).toBeUndefined();
    expect(fitStepParams("Linear", { model: "Linear", yKey: 0, statsVersion: 2 }).statsVersion).toBe(2);
    expect(fitStepParams("Linear", { model: "Linear", yKey: 0 })).not.toHaveProperty("statsVersion");
    expect(fitSpecFromStepParams({ model: "Linear", yKey: 0, statsVersion: 2 }).statsVersion).toBe(2);
  });

  it("a legacy spec replays under version 1 until the user updates it", () => {
    expect(statsVersionField({})).toEqual({ stats_version: 1 });
    expect(statsVersionField({ statsVersion: 2 })).toEqual({});
    expect(statsVersionField({}, true)).toEqual({});
  });

  it("a recompute takes the version the fitter declares, and keeps the spec's own when it declares none", () => {
    const now = () => "2026-11-13T00:00:00Z";
    const legacy = { model: "Linear", errors: [9] };
    expect(stampRecompute(legacy, { params: [1], errors: [0.1], statsVersion: 1 }, now).statsVersion).toBeUndefined();
    expect(stampRecompute(legacy, { params: [1], errors: [0.1], statsVersion: 2 }, now).statsVersion).toBe(2);
    expect(stampRecompute({ ...legacy, statsVersion: 2 }, { params: [1] }, now).statsVersion).toBe(2);
    expect(stampRecompute({ ...legacy, statsVersion: 2 }, { params: [1], statsVersion: 1 }, now).statsVersion).toBeUndefined();
  });

  it("labels old and new numbers differently", () => {
    expect(fitStatsLabels({ statsVersion: 2, weight: { mode: "yerr" } })).toMatchObject({ legacy: false, rmse: "RMSE (y units)" });
    expect(fitStatsLabels({ weight: { mode: "yerr" } })).toMatchObject({ legacy: true, rmse: "RMSE (weighted, unitless)" });
    expect(fitStatsLabels({})).toMatchObject({ legacy: true, rmse: "RMSE (y units)" });
  });
});
