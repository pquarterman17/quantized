// Curve Fit band plot data (fitBandData.ts): the merged data+grid rows, the
// band dataset's columns, and the styles that make the CI a real fill (the
// part that reaches the vector export).

import { describe, expect, it } from "vitest";

import type { BandsResult } from "../../../lib/api/fitStats";
import type { Dataset } from "../../../lib/types";
import { bandDataStruct, bandIsEmpty, bandRows, bandSourceFor, bandStyles, levelLabel } from "./fitBandData";

const BAND: BandsResult = {
  yFit: [1, 2, 3],
  ciLo: [0.5, 1.5, 2.5],
  ciHi: [1.5, 2.5, 3.5],
  piLo: [0, 1, 2],
  piHi: [2, 3, 4],
  level: 0.95,
};

const SRC = {
  datasetId: "d1",
  datasetName: "run.dat",
  model: "Linear",
  xLabel: "Field",
  xUnit: "Oe",
  yLabel: "M",
  yUnit: "emu",
};

describe("bandRows", () => {
  it("merges the fitted points with an even grid, ascending in x", () => {
    const r = bandRows([2, 0], [20, 0], 3);
    expect(r.x).toEqual([0, 0, 1, 2, 2]);
    // Data rows keep their y; grid rows are NaN.
    expect(r.y.filter((v) => !Number.isNaN(v)).sort()).toEqual([0, 20]);
    expect(r.y.filter((v) => Number.isNaN(v))).toHaveLength(3);
  });

  it("adds no grid for a single distinct x", () => {
    expect(bandRows([1, 1], [5, 6], 10).x).toEqual([1, 1]);
  });
});

describe("bandDataStruct", () => {
  it("carries data, fit and CI columns, with PI columns only when asked", () => {
    const rows = { x: [0, 1, 2], y: [1, Number.NaN, 3] };
    const ci = bandDataStruct(rows, BAND, false, SRC);
    expect(ci.labels).toEqual(["M", "Linear fit", "95% CI low", "95% CI high"]);
    expect(ci.values[1]).toEqual([Number.NaN, 2, 1.5, 2.5]);
    expect(ci.units).toEqual(["emu", "emu", "emu", "emu"]);
    expect(ci.metadata["x_column_long"]).toBe("Field");

    const pi = bandDataStruct(rows, BAND, true, SRC);
    expect(pi.labels.slice(4)).toEqual(["95% PI low", "95% PI high"]);
    expect(pi.values[2]).toEqual([3, 3, 2.5, 3.5, 2, 4]);
  });

  it("maps null limits to NaN", () => {
    const d = bandDataStruct({ x: [0], y: [1] }, { ...BAND, ciLo: [null], ciHi: [null] }, false, SRC);
    expect(d.values[0]!.slice(2).every((v) => Number.isNaN(v))).toBe(true);
  });
});

describe("bandStyles", () => {
  it("fills the CI low column against the CI high column", () => {
    expect(bandStyles(false)[2]?.fill).toEqual({ vs: 3 });
    expect(bandStyles(false)[4]).toBeUndefined();
  });

  it("fills the PI pair too when the prediction band is on", () => {
    expect(bandStyles(true)[4]?.fill).toEqual({ vs: 5 });
  });
});

describe("helpers", () => {
  it("reports an all-null band as empty", () => {
    expect(bandIsEmpty(BAND)).toBe(false);
    expect(bandIsEmpty({ ...BAND, ciLo: [null, null, null] })).toBe(true);
  });

  it("formats the level as a percentage", () => {
    expect(levelLabel(0.68)).toBe("68%");
  });

  it("names the axes from the fitted channels", () => {
    const ds: Dataset = {
      id: "d1",
      name: "run.dat",
      data: { time: [0], values: [[0, 0]], labels: ["H", "M"], units: ["Oe", "emu"], metadata: {} },
    };
    expect(bandSourceFor(ds, "Linear", 0, 1)).toMatchObject({ xLabel: "H", xUnit: "Oe", yLabel: "M", yUnit: "emu" });
    expect(bandSourceFor(ds, "Linear", null, 1).xLabel).toBe("x");
  });
});
