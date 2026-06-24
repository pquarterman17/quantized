import { describe, expect, it } from "vitest";

import {
  buildColumns,
  peakOverlayArray,
  withBaselineOverlay,
  withFitOverlay,
  withPeakOverlay,
  type PlotPayload,
} from "./plotdata";
import { makeDemoDataset } from "./demo";
import type { DataStruct } from "./types";

describe("buildColumns", () => {
  it("packs x + each channel as aligned columns", () => {
    const ds: DataStruct = {
      time: [0, 1, 2],
      values: [
        [10, 100],
        [20, 200],
        [30, 300],
      ],
      labels: ["A", "B"],
      units: ["V", "A"],
      metadata: { x_column_name: "T", x_column_unit: "s" },
    };
    const p = buildColumns(ds);
    expect(p.data).toEqual([
      [0, 1, 2],
      [10, 20, 30],
      [100, 200, 300],
    ]);
    expect(p.series).toEqual([
      { label: "A", unit: "V" },
      { label: "B", unit: "A" },
    ]);
    expect(p.xLabel).toBe("T");
    expect(p.xUnit).toBe("s");
  });

  it("maps non-finite values to null", () => {
    const ds: DataStruct = {
      time: [0, NaN, 2],
      values: [[1], [2], [Infinity]],
      labels: ["y"],
      units: [""],
      metadata: {},
    };
    const p = buildColumns(ds);
    expect(p.data[0]).toEqual([0, null, 2]);
    expect(p.data[1]).toEqual([1, 2, null]);
  });

  it("handles the demo dataset", () => {
    const p = buildColumns(makeDemoDataset());
    expect(p.data).toHaveLength(2); // x + 1 channel
    expect(p.data[0]).toHaveLength(201);
    expect(p.series[0].label).toBe("Moment");
  });
});

describe("withFitOverlay", () => {
  const base: PlotPayload = {
    data: [
      [0, 1, 2],
      [10, 20, 30],
    ],
    series: [{ label: "y", unit: "V" }],
    xLabel: "x",
    xUnit: "s",
  };

  it("appends the fit series when datasetId + length match", () => {
    const p = withFitOverlay(base, { datasetId: "d1", y: [11, 21, 31] }, "d1");
    expect(p.data).toHaveLength(3);
    expect(p.data[2]).toEqual([11, 21, 31]);
    expect(p.series[1]).toEqual({ label: "fit", unit: "" });
  });

  it("is a no-op when the overlay belongs to another dataset", () => {
    const p = withFitOverlay(base, { datasetId: "other", y: [11, 21, 31] }, "d1");
    expect(p).toBe(base);
  });

  it("is a no-op when the point count mismatches", () => {
    const p = withFitOverlay(base, { datasetId: "d1", y: [11, 21] }, "d1");
    expect(p).toBe(base);
  });

  it("is a no-op when there is no overlay", () => {
    expect(withFitOverlay(base, null, "d1")).toBe(base);
  });
});

describe("withBaselineOverlay", () => {
  const base: PlotPayload = {
    data: [
      [0, 1, 2],
      [10, 20, 30],
    ],
    series: [{ label: "y", unit: "V" }],
    xLabel: "x",
    xUnit: "s",
  };

  it("appends the baseline as a line series when id + length match", () => {
    const p = withBaselineOverlay(base, { datasetId: "d1", y: [1, 2, 3] }, "d1");
    expect(p.data).toHaveLength(3);
    expect(p.data[2]).toEqual([1, 2, 3]);
    expect(p.series[1]).toEqual({ label: "baseline", unit: "" });
  });

  it("is a no-op on mismatch / wrong dataset / null", () => {
    expect(withBaselineOverlay(base, { datasetId: "x", y: [1, 2, 3] }, "d1")).toBe(base);
    expect(withBaselineOverlay(base, { datasetId: "d1", y: [1, 2] }, "d1")).toBe(base);
    expect(withBaselineOverlay(base, null, "d1")).toBe(base);
  });
});

describe("peakOverlayArray", () => {
  it("marks the nearest data point to each peak center with its height", () => {
    const time = [0, 1, 2, 3, 4];
    const y = peakOverlayArray(time, [
      { center: 1.1, height: 9 },
      { center: 3.8, height: 5 },
    ]);
    expect(y).toEqual([null, 9, null, null, 5]); // nearest indices: 1 and 4
  });

  it("skips non-finite centers", () => {
    const y = peakOverlayArray([0, 1, 2], [{ center: NaN, height: 9 }]);
    expect(y).toEqual([null, null, null]);
  });
});

describe("withPeakOverlay", () => {
  const base: PlotPayload = {
    data: [
      [0, 1, 2],
      [10, 20, 30],
    ],
    series: [{ label: "y", unit: "V" }],
    xLabel: "x",
    xUnit: "s",
  };

  it("appends a points-kind series when datasetId + length match", () => {
    const p = withPeakOverlay(base, { datasetId: "d1", y: [null, 20, null] }, "d1");
    expect(p.data).toHaveLength(3);
    expect(p.series[1]).toEqual({ label: "peaks", unit: "", kind: "points" });
  });

  it("is a no-op for a mismatched dataset or length", () => {
    expect(withPeakOverlay(base, { datasetId: "x", y: [null, 1, null] }, "d1")).toBe(base);
    expect(withPeakOverlay(base, { datasetId: "d1", y: [1] }, "d1")).toBe(base);
    expect(withPeakOverlay(base, null, "d1")).toBe(base);
  });
});
