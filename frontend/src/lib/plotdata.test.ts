import { describe, expect, it } from "vitest";

import {
  applyWaterfall,
  buildColumns,
  effectiveChannels,
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
      { label: "A", unit: "V", axis: 0 },
      { label: "B", unit: "A", axis: 0 },
    ]);
    expect(p.xLabel).toBe("T");
    expect(p.xUnit).toBe("s");
  });

  it("tags y2Keys channels with axis 1 (offline dual-Y)", () => {
    const ds: DataStruct = {
      time: [0, 1],
      values: [
        [10, 100],
        [20, 200],
      ],
      labels: ["A", "B"],
      units: ["V", "A"],
      metadata: {},
    };
    const p = buildColumns(ds, [1]);
    expect(p.series.map((s) => s.axis)).toEqual([0, 1]);
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

  it("uses a value channel as the x-axis when xKey is set (M-vs-H)", () => {
    const ds: DataStruct = {
      time: [0, 1, 2], // time, ignored when xKey is set
      values: [
        [10, 100],
        [20, 200],
        [30, 300],
      ],
      labels: ["M", "H"],
      units: ["emu", "Oe"],
      metadata: { x_column_name: "T", x_column_unit: "s" },
    };
    const p = buildColumns(ds, null, 1); // x = channel 1 (H)
    expect(p.data[0]).toEqual([100, 200, 300]); // x is the H column
    expect(p.xLabel).toBe("H");
    expect(p.xUnit).toBe("Oe");
    // The x channel is excluded from the plotted series (no H-vs-H line).
    expect(p.series).toEqual([{ label: "M", unit: "emu", axis: 0 }]);
    expect(p.data[1]).toEqual([10, 20, 30]);
  });

  it("honors an explicit yChannels list alongside xKey", () => {
    const ds: DataStruct = {
      time: [0, 1],
      values: [
        [1, 2, 3],
        [4, 5, 6],
      ],
      labels: ["A", "B", "C"],
      units: ["", "", ""],
      metadata: {},
    };
    const p = buildColumns(ds, null, 0, [2]); // x = A, plot only C
    expect(p.series.map((s) => s.label)).toEqual(["C"]);
    expect(p.data[0]).toEqual([1, 4]); // A as x
    expect(p.data[1]).toEqual([3, 6]); // C as y
  });
});

describe("effectiveChannels", () => {
  const ds: DataStruct = {
    time: [0, 1],
    values: [
      [1, 2, 3],
      [4, 5, 6],
    ],
    labels: ["A", "B", "C"],
    units: ["", "", ""],
    metadata: {},
  };

  it("returns all channels when nothing is selected and x = time", () => {
    expect(effectiveChannels(ds, null, null)).toEqual([0, 1, 2]);
  });

  it("excludes the x-axis channel (can't plot a channel against itself)", () => {
    expect(effectiveChannels(ds, null, 1)).toEqual([0, 2]);
  });

  it("intersects the y selection with the x exclusion", () => {
    expect(effectiveChannels(ds, [1, 2], 2)).toEqual([1]);
  });

  it("excludes channels carrying a non-data role (label/ignore)", () => {
    expect(effectiveChannels(ds, null, null, { 1: "label" })).toEqual([0, 2]);
    expect(effectiveChannels(ds, null, null, { 0: "ignore", 2: "label" })).toEqual([1]);
  });

  it("combines the x exclusion and role exclusion", () => {
    expect(effectiveChannels(ds, null, 0, { 1: "ignore" })).toEqual([2]);
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

describe("applyWaterfall", () => {
  // Two series over the combined range [10, 40] → span 30.
  const base: PlotPayload = {
    data: [
      [0, 1, 2],
      [10, 20, 30],
      [20, 30, 40],
    ],
    series: [
      { label: "A", unit: "" },
      { label: "B", unit: "" },
    ],
    xLabel: "x",
    xUnit: "",
  };

  it("leaves channel 0 put and offsets later channels by (s-1)·frac·span", () => {
    const p = applyWaterfall(base, 0.5); // step = 0.5·30 = 15
    expect(p.data[0]).toEqual([0, 1, 2]); // x unchanged
    expect(p.data[1]).toEqual([10, 20, 30]); // first series unchanged
    expect(p.data[2]).toEqual([35, 45, 55]); // +15
  });

  it("is a no-op when off, or with fewer than 2 series", () => {
    expect(applyWaterfall(base, 0)).toBe(base);
    const one: PlotPayload = { ...base, data: [base.data[0], base.data[1]] as PlotPayload["data"] };
    expect(applyWaterfall(one, 0.5)).toBe(one);
  });

  it("preserves nulls (gaps) while offsetting finite points", () => {
    const withGap: PlotPayload = {
      ...base,
      data: [
        [0, 1, 2],
        [10, 20, 30],
        [20, null, 40],
      ],
    };
    const p = applyWaterfall(withGap, 1); // step = span 30
    expect(p.data[2]).toEqual([50, null, 70]);
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
