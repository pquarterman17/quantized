// Per-series X follow-ups: only SHOWN curves decide the X blocks, and "Plot
// together" never turns an error column or an empty spare column into a curve.
import { describe, expect, it } from "vitest";

import { R1, R2, T1, T2, t1r1t2r2 } from "../test/ownXFixture";
import { curvesForDatasets } from "./linkedCurves";
import { perSeriesXData } from "./perSeriesX";
import type { Dataset } from "./types";

describe("perSeriesXData with a shown set", () => {
  it("all curves shown: two blocks, T1 then T2 in row order, titled T1 / T2", () => {
    const v = perSeriesXData(t1r1t2r2(), null, [0, 2])!;
    expect(v.blocks).toEqual([null, 1]);
    expect(v.data.time).toEqual([...T1, ...T2]);
    expect(v.data.values.map((r) => r[0])).toEqual([...R1, NaN, NaN, NaN, NaN]);
    expect(v.data.values.map((r) => r[2])).toEqual([NaN, NaN, NaN, NaN, ...R2]);
    expect(v.data.metadata.x_column_long).toBe("T1 / T2");
  });

  it("R2 hidden: no view at all, so the X is not widened or retitled", () => {
    expect(perSeriesXData(t1r1t2r2(), null, [0])).toBeNull();
  });

  it("R1 hidden: a single block T2, the shared X is not seeded, X title is T2", () => {
    const v = perSeriesXData(t1r1t2r2(), null, [2])!;
    expect(v.blocks).toEqual([1]);
    expect(v.data.time).toEqual(T2);
    expect(v.data.values.map((r) => r[2])).toEqual(R2);
    expect(v.data.metadata.x_column_long).toBe("T2");
  });

  it("nothing shown: no view", () => {
    expect(perSeriesXData(t1r1t2r2(), null, [])).toBeNull();
  });

  it("hide then unhide (either order) matches a fresh build; time-X and hidden never collide in the cache", () => {
    const ds = t1r1t2r2();
    const fresh = (shown: number[]) => perSeriesXData(t1r1t2r2(), null, shown);
    // The SAME dataset object is queried repeatedly so its cache is exercised.
    const a1 = perSeriesXData(ds, null, [0, 2]);
    const a2 = perSeriesXData(ds, null, [2]); // R1 hidden
    const a3 = perSeriesXData(ds, null, [0, 2]); // R1 shown again
    expect(a3!.data.time).toEqual(fresh([0, 2])!.data.time);
    expect(a3!.data.values).toEqual(fresh([0, 2])!.data.values);
    expect(a3).toBe(a1);
    expect(a2!.data.time).toEqual(T2);
    // Reverse order on a fresh dataset: hidden-first, then unhidden.
    const ds2 = t1r1t2r2();
    const b1 = perSeriesXData(ds2, null, [2]);
    const b2 = perSeriesXData(ds2, null, [0, 2]);
    expect(b1!.data.time).toEqual(T2);
    expect(b2!.data.time).toEqual([...T1, ...T2]);
    expect(b2!.data.values).toEqual(fresh([0, 2])!.data.values);
    // R2 hidden collapses to the plain plot (null), then back.
    expect(perSeriesXData(ds2, null, [0])).toBeNull();
    expect(perSeriesXData(ds2, null, [0, 2])!.data.time).toEqual([...T1, ...T2]);
  });

  it("hiding a curve whose X block stays in use returns the same view object", () => {
    const ds: Dataset = {
      id: "three",
      name: "three",
      data: {
        time: T1,
        values: T1.map((_, i) => [R1[i], R1[i] + 1, T2[i], R2[i]]),
        labels: ["R1", "R1b", "T2", "R2"],
        units: ["", "", "", ""],
        metadata: {},
      },
      columnDesignations: { 2: "X" },
    };
    expect(perSeriesXData(ds, null, [0, 1, 3])).toBe(perSeriesXData(ds, null, [0, 3]));
  });
});

describe("curvesForDatasets on a designated sheet", () => {
  // time = T1; channels R1(Y), T2(X), R2(Y), dR2(Y-error), Spare (never filled).
  const sheet = (): Dataset => ({
    id: "s",
    name: "s",
    data: {
      time: T1,
      values: T1.map((_, i) => [R1[i], T2[i], R2[i], 1, NaN]),
      labels: ["R1", "T2", "R2", "dR2", "Spare"],
      units: ["", "", "", "", ""],
      metadata: {},
    },
    columnDesignations: { 0: "Y", 1: "X", 2: "Y", 3: "Y-error" },
  });

  it("draws R1 on T1 and R2 on T2 only: no error column, no all-NaN spare", () => {
    const curves = curvesForDatasets([sheet()], () => 0);
    expect(curves.map((c) => [c.yKey, c.xKey])).toEqual([[0, null], [2, 1]]);
  });

  it("an undesignated error column named by an error_channels hint is excluded too", () => {
    const ds = sheet();
    ds.columnDesignations = { 1: "X" };
    ds.data = { ...ds.data, metadata: { error_channels: { 2: 3 } } };
    expect(curvesForDatasets([ds], () => 0).map((c) => c.yKey)).toEqual([0, 2]);
  });
});
