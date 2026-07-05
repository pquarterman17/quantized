import { describe, expect, it } from "vitest";

import {
  applyWaterfall,
  buildColumns,
  clampPlottedRange,
  composeDisplayPayload,
  defaultDenseChannels,
  dropTrailingEmptyRows,
  effectiveChannels,
  highlightSelectedPayload,
  maskExcludedPayload,
  peakOverlayArray,
  primaryChannel,
  rowsInXRange,
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

  it("prefers the Origin long name over the column letter for the x-axis", () => {
    const ds: DataStruct = {
      time: [10, 20, 30],
      values: [[1], [2], [3]],
      labels: ["Intensity"],
      units: ["arb. units"],
      metadata: { x_column_long: "Theta", x_column_name: "A", x_column_unit: "Degrees" },
    };
    const p = buildColumns(ds);
    expect(p.xLabel).toBe("Theta"); // Origin shows the long name, not the letter "A"
    expect(p.xUnit).toBe("Degrees");
  });

  it("falls back to the column letter when no long name is present", () => {
    const ds: DataStruct = {
      time: [10, 20, 30],
      values: [[1], [2], [3]],
      labels: ["Intensity"],
      units: ["arb. units"],
      metadata: { x_column_name: "A", x_column_unit: "Degrees" },
    };
    expect(buildColumns(ds).xLabel).toBe("A");
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

  it("applies an explicit draw order over the filtered channels", () => {
    expect(effectiveChannels(ds, null, null, undefined, [2, 0, 1])).toEqual([2, 0, 1]);
  });

  it("appends channels missing from the order in their natural position", () => {
    // only channel 2 listed → it leads, then 0,1 keep their natural order.
    expect(effectiveChannels(ds, null, null, undefined, [2])).toEqual([2, 0, 1]);
  });

  it("ignores order entries that are not currently plotted (x-excluded)", () => {
    // x = channel 0; order names it but it's excluded → 2 then 1.
    expect(effectiveChannels(ds, null, 0, undefined, [0, 2, 1])).toEqual([2, 1]);
  });
});

describe("defaultDenseChannels / primaryChannel (NaN-sparse default selection)", () => {
  // Shaped like a Quantum Design magnetometry file: field (x) sweeps densely,
  // "Moment" is populated on every row, but an auxiliary column (e.g. an
  // AC-susceptibility or std-err channel only meaningful during a different
  // measurement sub-mode) is NaN on all but one row. Bug: the main plot used
  // to default to "every channel" (yKeys=null), so this single stray point
  // entered uPlot's shared y-axis autoscale and squashed the real Moment
  // curve down to invisibility — "mostly empty, one point visible" — even
  // though the Library thumbnail (hardcoded to channel 0) rendered fine.
  const N = 200;
  const field = Array.from({ length: N }, (_, i) => -1000 + (2000 * i) / (N - 1));
  const sparseCol = Array.from({ length: N }, (_, i) => (i === 100 ? 42 : NaN));
  const momentCol = Array.from({ length: N }, (_, i) => Math.sin(i / 10) * 1e-3);
  const ds: DataStruct = {
    time: field,
    values: sparseCol.map((s, i) => [s, momentCol[i]]),
    labels: ["M. Std. Err.", "Moment"],
    units: ["emu", "emu"],
    metadata: { x_column_name: "Magnetic Field", x_column_unit: "Oe" },
  };

  it("excludes the NaN-sparse channel from the default (yKeys=null) set", () => {
    expect(defaultDenseChannels(ds)).toEqual([1]);
    expect(effectiveChannels(ds, null, null)).toEqual([1]);
  });

  it("primaryChannel picks the dense channel even though it isn't index 0", () => {
    expect(primaryChannel(ds)).toBe(1);
  });

  it("buildColumns' offline default matches the dense-only selection", () => {
    const p = buildColumns(ds);
    expect(p.series).toEqual([{ label: "Moment", unit: "emu", axis: 0 }]);
    expect(p.data).toHaveLength(2); // x + the one dense channel
    expect(p.data[1]).toEqual(momentCol);
  });

  it("still honors an explicit yKeys that names the sparse channel", () => {
    // A deliberate user choice is never second-guessed by the density filter.
    expect(effectiveChannels(ds, [0, 1], null)).toEqual([0, 1]);
  });

  it("falls back to every candidate when none are meaningfully denser than the rest", () => {
    const flat: DataStruct = {
      time: [0, 1, 2, 3],
      values: [
        [1, NaN],
        [NaN, 2],
        [3, NaN],
        [NaN, 4],
      ],
      labels: ["A", "B"],
      units: ["", ""],
      metadata: {},
    };
    // Both channels are equally (50%) sparse — no channel is "the densest by
    // a wide margin", so nothing is hidden (better a cluttered plot than an
    // arbitrarily empty one).
    expect(defaultDenseChannels(flat)).toEqual([0, 1]);
  });

  it("honors a parser default_value_channels hint over the density heuristic", () => {
    // Reflectometry .dat: every column is dense, but the parser hints that only
    // R (1) and theory (3) should plot by default (dQ/dR/fresnel stay off).
    const row = [1, 1, 1, 1, 1];
    const refl: DataStruct = {
      time: [0.01, 0.02, 0.03],
      values: [row, row, row],
      labels: ["dQ", "R", "dR", "theory", "fresnel"],
      units: ["1/A", "", "", "", ""],
      metadata: { default_value_channels: [1, 3] },
    };
    expect(defaultDenseChannels(refl)).toEqual([1, 3]);
  });

  it("ignores an out-of-range hint and falls back to the heuristic", () => {
    const ds2: DataStruct = {
      time: [0, 1, 2],
      values: [
        [1, 2],
        [1, 2],
        [1, 2],
      ],
      labels: ["A", "B"],
      units: ["", ""],
      metadata: { default_value_channels: [9, 9] },
    };
    expect(defaultDenseChannels(ds2)).toEqual([0, 1]);
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

describe("overlay alignment to a trailing-trimmed payload (Hc2 sparse worksheet)", () => {
  // dropTrailingEmptyRows shrinks the plotted payload to the drawable rows, but
  // fit/baseline/peak overlays are built at the dataset's FULL length. A longer
  // overlay is a prefix of the plotted rows, so it must be TRUNCATED — not
  // silently dropped, which used to make overlays vanish on sparse datasets.
  const trimmed: PlotPayload = {
    data: [
      [0, 0.13, 0.23],
      [1.3, 1.9, 7.8],
    ],
    series: [{ label: "y", unit: "" }],
    xLabel: "x",
    xUnit: "",
  };

  it("truncates a full-length fit overlay instead of dropping it", () => {
    const p = withFitOverlay(trimmed, { datasetId: "d1", y: [1.2, 2, 7.5, null, null, null] }, "d1");
    expect(p.data).toHaveLength(3);
    expect(p.data[2]).toEqual([1.2, 2, 7.5]);
    expect(p.series[1]).toEqual({ label: "fit", unit: "" });
  });

  it("truncates a full-length baseline overlay", () => {
    const p = withBaselineOverlay(trimmed, { datasetId: "d1", y: [0.1, 0.2, 0.3, 0, 0, 0] }, "d1");
    expect(p.data[2]).toEqual([0.1, 0.2, 0.3]);
  });

  it("truncates a full-length peak overlay", () => {
    const p = withPeakOverlay(trimmed, { datasetId: "d1", y: [null, 5, null, null, null, null] }, "d1");
    expect(p.data[2]).toEqual([null, 5, null]);
  });

  it("still drops an overlay strictly shorter than the plotted x", () => {
    expect(withFitOverlay(trimmed, { datasetId: "d1", y: [1.2, 2] }, "d1")).toBe(trimmed);
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

describe("maskExcludedPayload", () => {
  const payload: PlotPayload = {
    data: [
      [0, 1, 2, 3],
      [10, 20, 30, 40],
    ],
    series: [{ label: "y", unit: "emu" }],
    xLabel: "x",
    xUnit: "",
  };

  it("returns the same payload when nothing is dropped (identity)", () => {
    expect(maskExcludedPayload(payload, new Set(), "hide")).toBe(payload);
    expect(maskExcludedPayload(payload, new Set(), "grey")).toBe(payload);
  });

  it("hide: nulls the dropped rows in the data series, x + series count intact", () => {
    const out = maskExcludedPayload(payload, new Set([1, 3]), "hide");
    expect(out.data[0]).toEqual([0, 1, 2, 3]); // x untouched
    expect(out.data[1]).toEqual([10, null, 30, null]);
    expect(out.series).toHaveLength(1);
  });

  it("grey: nulls the main series AND appends a muted points-companion of the dropped points", () => {
    const out = maskExcludedPayload(payload, new Set([1]), "grey");
    expect(out.data[1]).toEqual([10, null, 30, 40]); // main: kept only
    expect(out.data[2]).toEqual([null, 20, null, null]); // ghost: dropped only
    expect(out.series).toHaveLength(2);
    expect(out.series[1]).toMatchObject({ kind: "points", muted: true });
    expect(out.series[1].label).toContain("excluded");
  });

  it("does not mutate the input payload", () => {
    maskExcludedPayload(payload, new Set([0]), "grey");
    expect(payload.data[1]).toEqual([10, 20, 30, 40]);
    expect(payload.series).toHaveLength(1);
  });
});

describe("rowsInXRange (#50 plot-brush)", () => {
  const xs = [0, 1, 2, 3, 4];
  it("returns original indices whose x falls within the band (endpoints in any order)", () => {
    expect(rowsInXRange(xs, 1, 3)).toEqual([1, 2, 3]);
    expect(rowsInXRange(xs, 3, 1)).toEqual([1, 2, 3]); // order-independent
  });
  it("is inclusive of the endpoints and empty for an out-of-range band", () => {
    expect(rowsInXRange(xs, 4, 4)).toEqual([4]);
    expect(rowsInXRange(xs, 10, 20)).toEqual([]);
  });
  it("skips null / non-finite x", () => {
    expect(rowsInXRange([0, null, 2, NaN, 4], 0, 4)).toEqual([0, 2, 4]);
  });
});

describe("highlightSelectedPayload (#50 plot-brush)", () => {
  const payload: PlotPayload = {
    data: [
      [0, 1, 2, 3],
      [10, 20, 30, 40],
    ],
    series: [{ label: "y", unit: "emu" }],
    xLabel: "x",
    xUnit: "",
  };
  it("is the identity when nothing is selected", () => {
    expect(highlightSelectedPayload(payload, new Set())).toBe(payload);
  });
  it("appends an accent points-companion carrying only the selected rows", () => {
    const out = highlightSelectedPayload(payload, new Set([1, 3]));
    expect(out.data[1]).toEqual([10, 20, 30, 40]); // main series untouched
    expect(out.data[2]).toEqual([null, 20, null, 40]); // marks: selected only
    expect(out.series).toHaveLength(2);
    expect(out.series[1]).toMatchObject({ kind: "points", selected: true });
    expect(out.series[1].label).toContain("selected");
  });
  it("does not mutate the input payload", () => {
    highlightSelectedPayload(payload, new Set([0]));
    expect(payload.series).toHaveLength(1);
  });
});

describe("clampPlottedRange (#50)", () => {
  const xs = [0, 1, 2, 3, 4];
  it("clamps to the data extent and orders low→high", () => {
    expect(clampPlottedRange(xs, 1, 3)).toEqual([1, 3]);
    expect(clampPlottedRange(xs, -5, 99)).toEqual([0, 4]); // clamped to extent
    expect(clampPlottedRange(xs, 3, 1)).toEqual([1, 3]); // reordered
  });
  it("returns null for a degenerate (zero-width / no-finite-x) drag", () => {
    expect(clampPlottedRange(xs, 2, 2)).toBeNull();
    expect(clampPlottedRange([null, NaN], 0, 1)).toBeNull();
  });
});

describe("composeDisplayPayload (#50 layer order)", () => {
  const base: PlotPayload = {
    data: [
      [0, 1, 2, 3],
      [10, 20, 30, 40],
    ],
    series: [{ label: "y", unit: "emu" }],
    xLabel: "x",
    xUnit: "",
  };
  const empty = {
    id: "d1",
    waterfall: 0,
    dropped: new Set<number>(),
    excludedDisplay: "hide" as const,
    fitOverlay: null,
    baselineOverlay: null,
    peakOverlay: null,
    selection: null,
  };

  it("is a near-identity when no masking / overlays / selection apply", () => {
    const out = composeDisplayPayload(base, empty);
    expect(out.data[1]).toEqual([10, 20, 30, 40]);
    expect(out.series).toHaveLength(1);
  });

  it("masks dropped rows AND appends the selection highlight (both honored)", () => {
    const out = composeDisplayPayload(base, {
      ...empty,
      dropped: new Set([0]),
      selection: { datasetId: "d1", rows: [2] },
    });
    expect(out.data[1]).toEqual([null, 20, 30, 40]); // row 0 hidden
    // last series is the accent selection companion with only row 2 set
    const marks = out.data[out.data.length - 1] as (number | null)[];
    expect(marks).toEqual([null, null, 30, null]);
    expect(out.series[out.series.length - 1]).toMatchObject({ selected: true });
  });

  it("ignores a selection that targets a different dataset", () => {
    const out = composeDisplayPayload(base, {
      ...empty,
      selection: { datasetId: "other", rows: [2] },
    });
    expect(out.series).toHaveLength(1); // no highlight companion added
  });
});

describe("dropTrailingEmptyRows", () => {
  const mk = (x: (number | null)[]): PlotPayload => ({
    data: [x, x.map((_, i) => i)] as PlotPayload["data"],
    series: [{ label: "y", unit: "", axis: 0 }],
    xLabel: "x",
    xUnit: "",
  });
  // x + two y-series; a row is empty only when BOTH y are null.
  const mkXY = (x: (number | null)[], y1: (number | null)[], y2: (number | null)[]): PlotPayload => ({
    data: [x, y1, y2] as PlotPayload["data"],
    series: [
      { label: "y1", unit: "", axis: 0 },
      { label: "y2", unit: "", axis: 0 },
    ],
    xLabel: "x",
    xUnit: "",
  });

  it("trims trailing null x (the Origin allocated-but-unfilled artifact)", () => {
    // Regression: uPlot reads the LAST x as the axis max (sorted-x optimization),
    // so a trailing null collapsed autoscale to ~[min, 0] and hid the data.
    const out = dropTrailingEmptyRows(mk([-10, -9, 0, 500, 1255, null, null]));
    expect(out.data[0]).toEqual([-10, -9, 0, 500, 1255]);
    expect(out.data[1]).toEqual([0, 1, 2, 3, 4]); // y stays aligned
  });

  it("also trims trailing NaN/Infinity x", () => {
    const out = dropTrailingEmptyRows(mk([0, 1, 2, NaN, Infinity]));
    expect(out.data[0]).toEqual([0, 1, 2]);
  });

  it("trims trailing rows where x is filled but every y is null (Hc2 sparse worksheet)", () => {
    // The real Hc2 case: a formula-filled x column (0..10) with measured y only
    // in the first few rows. x is never null, so the old null-x-only trim missed
    // it and the 3 real points collapsed against the left edge.
    const out = dropTrailingEmptyRows(
      mkXY([0, 0.13, 0.23, 0.5, 1, 10], [1.3, 1.9, 7.8, null, null, null], [5, 13, 95, null, null, null]),
    );
    expect(out.data[0]).toEqual([0, 0.13, 0.23]); // x-axis now fits the data
    expect(out.data[1]).toEqual([1.3, 1.9, 7.8]);
    expect(out.data[2]).toEqual([5, 13, 95]);
  });

  it("keeps a trailing row where x is filled and at least one y has data", () => {
    const out = dropTrailingEmptyRows(mkXY([0, 1, 2], [1, null, 3], [null, null, null]));
    expect(out.data[0]).toEqual([0, 1, 2]); // last row has y1=3 → drawable
  });

  it("returns the same payload object when there is no trailing empty tail", () => {
    const p = mk([0, 1, 2, 3]);
    expect(dropTrailingEmptyRows(p)).toBe(p); // fast path, no realloc
  });

  it("leaves interior nulls in place (uPlot draws them as gaps)", () => {
    const out = dropTrailingEmptyRows(mk([0, null, 2, 3]));
    expect(out.data[0]).toEqual([0, null, 2, 3]);
  });
});
