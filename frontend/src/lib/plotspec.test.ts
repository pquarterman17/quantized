import { describe, expect, it } from "vitest";

import {
  assignZone,
  channelRefEq,
  clearZone,
  cycleMark,
  defaultMark,
  deserializePlotSpec,
  emptySpec,
  inferMark,
  isMonotonicChannel,
  markContext,
  markFamily,
  markSeriesStyle,
  moveYZone,
  plotSpecCoreEqual,
  plotSpecsEqual,
  prefillErrorZones,
  sanitizeSavedPlotSpecs,
  serializePlotSpec,
  specDatasetId,
  specErrorBindings,
  specToRender,
  validMarks,
  validatePlotSpec,
  withInferredMark,
  type ChannelRef,
  type MarkContext,
  type PlotSpec,
  type SavedPlotSpec,
} from "./plotspec";
import type { DataStruct, Dataset, ModelingType } from "./types";

// ── Fixtures ─────────────────────────────────────────────────────────────────
// 12 rows so nominal inference can fire (≥12 samples, ≤8 levels). channel 0 is a
// monotonic continuous x; channel 1 a continuous y; channel 2 a 2-level nominal
// grouping column.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  values: [
    [1, 10, 0],
    [2, 12, 0],
    [3, 14, 0],
    [4, 16, 0],
    [5, 18, 0],
    [6, 20, 0],
    [7, 30, 1],
    [8, 32, 1],
    [9, 34, 1],
    [10, 36, 1],
    [11, 38, 1],
    [12, 40, 1],
  ],
  labels: ["x", "y", "grp"],
  units: ["s", "emu", ""],
  metadata: { x_column_name: "T" },
};
const DS: Dataset = { id: "d1", name: "run.dat", data: DATA };

// A second fixture for box/bar faceting (GUI_INTERACTION #11): channel 0 is
// the box/bar GROUP column (2-level nominal, needs ≥12 finite samples),
// channel 1 the value column, channel 2 a THIRD column used only as the
// FACET (3 levels: "0"/"1" carry real data, "2" is entirely non-finite in
// BOTH the group and value columns — a facet level that groups to nothing
// finite in either mark, so it must drop from `facets` for box AND bar).
const FACET_DATA: DataStruct = {
  time: Array.from({ length: 16 }, (_, i) => i),
  values: [
    [0, 10, 0],
    [0, 12, 0],
    [0, 14, 0],
    [1, 30, 0],
    [1, 32, 0],
    [1, 34, 0],
    [0, 110, 1],
    [0, 112, 1],
    [0, 114, 1],
    [1, 130, 1],
    [1, 132, 1],
    [1, 134, 1],
    [NaN, NaN, 2],
    [NaN, NaN, 2],
    [NaN, NaN, 2],
    [NaN, NaN, 2],
  ],
  labels: ["grp", "y", "fac"],
  units: ["", "", ""],
  metadata: {},
};
const FACET_DS: Dataset = { id: "d3", name: "facet3.dat", data: FACET_DATA };

const TYPES: Record<number, ModelingType> = { 0: "continuous", 1: "continuous", 2: "nominal" };
const ctx = (xMonotonic?: boolean): MarkContext => ({
  typeOf: (r) => TYPES[r.channel] ?? "continuous",
  xMonotonic,
});
const ref = (channel: number, datasetId = "d1"): ChannelRef => ({ datasetId, channel });

/** Build a spec from zone refs + mark (test convenience). */
function spec(
  x: ChannelRef | null,
  y: ChannelRef[],
  mark: PlotSpec["mark"],
  group: ChannelRef | null = null,
  facet: ChannelRef | null = null,
  yErr: ChannelRef[] = [],
  xErr: ChannelRef | null = null,
): PlotSpec {
  return { version: 1, zones: { x, y, group, facet, yErr, xErr }, mark };
}

// ── ChannelRef / zone algebra ────────────────────────────────────────────────
describe("channelRefEq + zone assignment", () => {
  it("compares refs structurally, null-safe", () => {
    expect(channelRefEq(ref(1), ref(1))).toBe(true);
    expect(channelRefEq(ref(1), ref(2))).toBe(false);
    expect(channelRefEq(ref(1, "d2"), ref(1, "d1"))).toBe(false);
    expect(channelRefEq(null, null)).toBe(true);
    expect(channelRefEq(ref(1), null)).toBe(false);
  });

  it("replaces single-slot zones and appends+dedupes the Y list", () => {
    let s = emptySpec();
    s = assignZone(s, "x", ref(0));
    s = assignZone(s, "x", ref(3)); // replace
    expect(s.zones.x).toEqual(ref(3));
    s = assignZone(s, "y", ref(1));
    s = assignZone(s, "y", ref(2));
    s = assignZone(s, "y", ref(1)); // dedupe
    expect(s.zones.y).toEqual([ref(1), ref(2)]);
  });

  it("clears single slots and removes from the Y list", () => {
    let s = spec(ref(0), [ref(1), ref(2)], "scatter", ref(2));
    s = clearZone(s, "y", ref(1));
    expect(s.zones.y).toEqual([ref(2)]);
    s = clearZone(s, "group");
    expect(s.zones.group).toBeNull();
  });

  it("moves Y refs by one explicit display-order slot and no-ops at boundaries", () => {
    const original = spec(ref(0), [ref(1), ref(2), ref(3)], "line");
    const moved = moveYZone(original, ref(3), -1);
    expect(moved.zones.y).toEqual([ref(1), ref(3), ref(2)]);
    expect(moveYZone(moved, ref(1), -1)).toBe(moved);
    expect(moveYZone(moved, ref(99), 1)).toBe(moved);
  });

  it("specDatasetId resolves the shared dataset (X wins, then Y)", () => {
    expect(specDatasetId(emptySpec())).toBeNull();
    expect(specDatasetId(spec(null, [ref(1)], "scatter"))).toBe("d1");
    expect(specDatasetId(spec(ref(0, "dx"), [ref(1)], "scatter"))).toBe("dx");
  });
});

// ── Mark morphing (the grammar) ──────────────────────────────────────────────
describe("markFamily", () => {
  it("is null with no Y (incomplete)", () => {
    expect(markFamily(spec(ref(0), [], "scatter"), ctx())).toBeNull();
  });
  it("is xy for continuous/empty X + Y", () => {
    expect(markFamily(spec(ref(0), [ref(1)], "scatter"), ctx())).toBe("xy");
    expect(markFamily(spec(null, [ref(1)], "scatter"), ctx())).toBe("xy");
  });
  it("is categorical for a nominal X + Y", () => {
    expect(markFamily(spec(ref(2), [ref(1)], "scatter"), ctx())).toBe("categorical");
  });
});

describe("validMarks", () => {
  it("offers scatter/line/step for xy, box/violin/bar for categorical, none for incomplete", () => {
    expect(validMarks(spec(ref(0), [ref(1)], "scatter"), ctx())).toEqual(["scatter", "line", "step"]);
    expect(validMarks(spec(ref(2), [ref(1)], "box"), ctx())).toEqual(["box", "violin", "bar"]);
    expect(validMarks(spec(ref(0), [], "scatter"), ctx())).toEqual([]);
  });
});

describe("defaultMark", () => {
  it("continuous×continuous defaults to scatter, or line when X is monotonic", () => {
    const s = spec(ref(0), [ref(1)], "box"); // mark irrelevant to defaultMark
    expect(defaultMark(s, ctx(false))).toBe("scatter");
    expect(defaultMark(s, ctx(undefined))).toBe("scatter");
    expect(defaultMark(s, ctx(true))).toBe("line");
  });
  it("categorical defaults to box", () => {
    expect(defaultMark(spec(ref(2), [ref(1)], "scatter"), ctx())).toBe("box");
  });
});

describe("inferMark — the morph rules", () => {
  it("two continuous columns → scatter", () => {
    expect(inferMark(spec(ref(0), [ref(1)], "scatter"), ctx())).toBe("scatter");
  });

  it("swapping a nominal column onto X morphs scatter → box", () => {
    // was a scatter; X becomes nominal → scatter invalid → snaps to box
    expect(inferMark(spec(ref(2), [ref(1)], "scatter"), ctx())).toBe("box");
  });

  it("is sticky within a family (keeps violin when a Y is added)", () => {
    expect(inferMark(spec(ref(2), [ref(1)], "violin"), ctx())).toBe("violin");
  });

  it("snaps across families (violin → scatter when X turns continuous)", () => {
    expect(inferMark(spec(ref(0), [ref(1)], "violin"), ctx(false))).toBe("scatter");
    expect(inferMark(spec(ref(0), [ref(1)], "violin"), ctx(true))).toBe("line");
  });

  it("leaves the mark alone when the spec is incomplete", () => {
    expect(inferMark(spec(ref(0), [], "violin"), ctx())).toBe("violin");
  });

  it("withInferredMark returns the updated spec (and is identity when unchanged)", () => {
    const s = spec(ref(2), [ref(1)], "scatter");
    expect(withInferredMark(s, ctx()).mark).toBe("box");
    const stable = spec(ref(0), [ref(1)], "scatter");
    expect(withInferredMark(stable, ctx())).toBe(stable);
  });
});

describe("cycleMark", () => {
  it("cycles box → violin → bar → box", () => {
    const base = spec(ref(2), [ref(1)], "box");
    const c = ctx();
    expect(cycleMark({ ...base, mark: "box" }, c)).toBe("violin");
    expect(cycleMark({ ...base, mark: "violin" }, c)).toBe("bar");
    expect(cycleMark({ ...base, mark: "bar" }, c)).toBe("box");
  });
  it("cycles scatter → line → step → scatter", () => {
    const base = spec(ref(0), [ref(1)], "scatter");
    const c = ctx();
    expect(cycleMark({ ...base, mark: "scatter" }, c)).toBe("line");
    expect(cycleMark({ ...base, mark: "line" }, c)).toBe("step");
    expect(cycleMark({ ...base, mark: "step" }, c)).toBe("scatter");
  });
  it("no-ops on an incomplete spec", () => {
    expect(cycleMark(spec(ref(0), [], "scatter"), ctx())).toBe("scatter");
  });
});

// ── markSeriesStyle (GAP_PLOTTYPES: the mark → Stage style bridge) ──────────
describe("markSeriesStyle", () => {
  it("scatter: zero width + markers on — the SeriesStyle 'no line' mechanism", () => {
    expect(markSeriesStyle(spec(ref(0), [ref(1)], "scatter"))).toEqual({ width: 0, marker: true });
  });

  it("line with no showMarkers: nothing to override", () => {
    expect(markSeriesStyle(spec(ref(0), [ref(1)], "line"))).toEqual({});
  });

  it("line with showMarkers: markers on, line width untouched (Origin's Line + Symbol)", () => {
    const s: PlotSpec = { ...spec(ref(0), [ref(1)], "line"), showMarkers: true };
    expect(markSeriesStyle(s)).toEqual({ marker: true });
  });

  it("step with no stepMode defaults to post, no markers", () => {
    expect(markSeriesStyle(spec(ref(0), [ref(1)], "step"))).toEqual({ step: "post" });
  });

  it("step honors an explicit stepMode + showMarkers", () => {
    const s: PlotSpec = { ...spec(ref(0), [ref(1)], "step"), stepMode: "mid", showMarkers: true };
    expect(markSeriesStyle(s)).toEqual({ step: "mid", marker: true });
  });

  it("box/violin/bar: nothing to override (not an xy mark)", () => {
    expect(markSeriesStyle(spec(ref(2), [ref(1)], "box"))).toEqual({});
  });
});

// ── Error wells (ORIGIN_GAP_PLAN #51 phase 3 — the COLUMN-DESIGNATION model)
// ─────────────────────────────────────────────────────────────────────────
// channel 0 "R" is a Y value; channel 1 "dR" is its error (leading-d
// convention -> unambiguous base-name match to "R"); channel 2 "Y2" has NO
// recognizable error column; channel 3 "xerr" is a global X error.
const ERR_DATA: DataStruct = {
  time: [0, 1, 2],
  values: [
    [1, 0.1, 5, 0.01],
    [2, 0.2, 6, 0.02],
    [3, 0.3, 7, 0.03],
  ],
  labels: ["R", "dR", "Y2", "xerr"],
  units: ["", "", "", ""],
  metadata: {},
};
const ERR_DS: Dataset = { id: "de", name: "err.dat", data: ERR_DATA };
const eref = (channel: number): ChannelRef => ({ datasetId: "de", channel });

describe("specErrorBindings", () => {
  it("position-pairs yErr[i] with y[i] — regression: y[1]'s error pairs to y[1], not y[0]", () => {
    const s = spec(null, [eref(5), eref(7)], "scatter", null, null, [eref(50), eref(70)]);
    expect(specErrorBindings(s)).toEqual([
      { channel: 50, target: 5, axis: "y", side: "both" },
      { channel: 70, target: 7, axis: "y", side: "both" },
    ]);
  });

  it("binds xErr to the x-axis sentinel target -1", () => {
    const s = spec(null, [eref(5)], "scatter", null, null, [], eref(9));
    expect(specErrorBindings(s)).toEqual([{ channel: 9, target: -1, axis: "x", side: "both" }]);
  });

  it("combines yErr and xErr bindings", () => {
    const s = spec(null, [eref(5)], "scatter", null, null, [eref(50)], eref(9));
    expect(specErrorBindings(s)).toEqual([
      { channel: 50, target: 5, axis: "y", side: "both" },
      { channel: 9, target: -1, axis: "x", side: "both" },
    ]);
  });

  it("is empty for empty wells", () => {
    expect(specErrorBindings(spec(null, [eref(5)], "scatter"))).toEqual([]);
  });

  it("defensively truncates a yErr longer than y (never invents a pairing)", () => {
    // Bypasses assignZone/validatePlotSpec — a raw shape a caller could still
    // hand this pure function directly.
    const s: PlotSpec = {
      ...spec(null, [eref(5)], "scatter"),
      zones: { ...spec(null, [eref(5)], "scatter").zones, yErr: [eref(50), eref(70)] },
    };
    expect(specErrorBindings(s)).toEqual([{ channel: 50, target: 5, axis: "y", side: "both" }]);
  });
});

describe("prefillErrorZones", () => {
  it("prefills yErr from an unambiguous inferred binding (and xErr, independently)", () => {
    const s = spec(null, [eref(0)], "scatter");
    const filled = prefillErrorZones(s, ERR_DATA, "de");
    expect(filled.zones.yErr).toEqual([eref(1)]);
    expect(filled.zones.xErr).toEqual(eref(3)); // ERR_DATA's "xerr" column, dataset-wide
  });

  it("prefills xErr independently of yErr", () => {
    const s = spec(null, [eref(2)], "scatter"); // Y2 has no inferred error
    const filled = prefillErrorZones(s, ERR_DATA, "de");
    expect(filled.zones.yErr).toEqual([]);
    expect(filled.zones.xErr).toEqual(eref(3));
  });

  it("stops the yErr prefix at the first ambiguous/unmatched Y (never invents a gap)", () => {
    const s = spec(null, [eref(0), eref(2)], "scatter"); // R has dR, Y2 does not
    const filled = prefillErrorZones(s, ERR_DATA, "de");
    expect(filled.zones.yErr).toEqual([eref(1)]); // stops before Y2, doesn't skip it
  });

  it("prefills nothing when the dataset has no recognizable error columns (ambiguous/none)", () => {
    const filled = prefillErrorZones(spec(ref(0), [ref(1)], "scatter"), DATA, "d1");
    expect(filled.zones.yErr).toEqual([]);
    expect(filled.zones.xErr).toBeNull();
  });

  it("leaves x/y/group/facet/mark untouched", () => {
    const s = spec(ref(3, "de"), [eref(0)], "line", eref(3), null);
    const filled = prefillErrorZones(s, ERR_DATA, "de");
    expect(filled.zones.x).toEqual(ref(3, "de"));
    expect(filled.zones.group).toEqual(ref(3, "de"));
    expect(filled.mark).toBe("line");
  });
});

// ── Live-context resolution ──────────────────────────────────────────────────
describe("markContext + isMonotonicChannel", () => {
  it("detects a monotonic channel (and a non-monotonic one)", () => {
    expect(isMonotonicChannel(DATA, 0)).toBe(true); // 1..12
    expect(isMonotonicChannel(DATA, 2)).toBe(true); // 0…0,1…1 non-decreasing
    const wobble: DataStruct = { ...DATA, values: [[1, 0, 0], [3, 0, 0], [2, 0, 0]] };
    expect(isMonotonicChannel(wobble, 0)).toBe(false);
  });

  it("resolves modeling types + xMonotonic from real datasets", () => {
    const s = spec(ref(0), [ref(1)], "scatter");
    const c = markContext(s, [DS]);
    expect(c.typeOf(ref(2))).toBe("nominal");
    expect(c.typeOf(ref(1))).toBe("continuous");
    expect(c.xMonotonic).toBe(true);
    // A monotonic-x continuous combo then infers a line via defaultMark.
    expect(inferMark(spec(ref(0), [ref(1)], "box"), c)).toBe("line");
  });
});

// ── specToRender ─────────────────────────────────────────────────────────────
describe("specToRender", () => {
  it("continuous X + Y → an xy scatter payload", () => {
    const r = specToRender(spec(ref(0), [ref(1)], "scatter"), [DS]);
    expect(r.kind).toBe("xy");
    if (r.kind !== "xy") return;
    expect(r.mark).toBe("scatter");
    expect(r.grouped).toBe(false);
    expect(r.payload.data).toHaveLength(2); // x + 1 series
    expect(r.payload.data[0]).toHaveLength(12);
    expect(r.payload.series).toHaveLength(1);
    expect(r.payload.xLabel).toBe("x");
  });

  it("step mark → an xy render carrying stepMode (default 'post') and showMarkers when set", () => {
    const r = specToRender({ ...spec(ref(0), [ref(1)], "step"), showMarkers: true }, [DS]);
    expect(r.kind).toBe("xy");
    if (r.kind !== "xy") return;
    expect(r.mark).toBe("step");
    expect(r.stepMode).toBe("post");
    expect(r.showMarkers).toBe(true);
  });

  it("an xy render omits stepMode/showMarkers when not applicable/set", () => {
    const r = specToRender(spec(ref(0), [ref(1)], "scatter"), [DS]);
    expect(r.kind).toBe("xy");
    if (r.kind !== "xy") return;
    expect(r.stepMode).toBeUndefined();
    expect(r.showMarkers).toBeUndefined();
  });

  it("a group channel splits the xy payload into one series per level", () => {
    const r = specToRender(spec(ref(0), [ref(1)], "scatter", ref(2)), [DS]);
    expect(r.kind).toBe("xy");
    if (r.kind !== "xy") return;
    expect(r.grouped).toBe(true);
    expect(r.payload.series).toHaveLength(2); // grp levels 0 and 1
    expect(r.payload.series[0].label).toContain("grp=0");
    expect(r.payload.series[1].label).toContain("grp=1");
  });

  // Cross-language parity fixture (GUI_INTERACTION #12 Slice 5): the SAME
  // tiny dataset + hand-computed expected series is asserted here AND in
  // the backend's tests/test_calc_plotting.py
  // (test_build_grouped_series_matches_frontend_parity_fixture) -- if
  // buildXY's group-split algorithm and its Python port
  // (calc.plotting.build_grouped_series) ever drift, one of the two tests
  // catches it. Row 2's NaN VALUE proves per-series finite-masking applies
  // independently of the group match; row 4's NaN GROUP proves a
  // non-finite group value is dropped from `levels` (never becomes its
  // own series). Integer-valued levels ("Group=1", not "Group=1.0") also
  // pin JS's `${level}` coercion, which the Python port must match by hand
  // (calc.plotting._format_level).
  it("cross-language parity fixture: matches the backend's build_grouped_series exactly", () => {
    const parityData: DataStruct = {
      time: [0, 1, 2, 3, 4],
      values: [[10, 1], [20, 2], [NaN, 1], [40, 2], [50, NaN]],
      labels: ["Value", "Group"],
      units: ["V", ""],
      metadata: {},
    };
    const parityDs: Dataset = { id: "p1", name: "parity.dat", data: parityData };
    const r = specToRender(
      spec(null, [{ datasetId: "p1", channel: 0 }], "scatter", { datasetId: "p1", channel: 1 }),
      [parityDs],
    );
    expect(r.kind).toBe("xy");
    if (r.kind !== "xy") return;
    expect(r.payload.series.map((s) => s.label)).toEqual([
      "Value (Group=1)",
      "Value (Group=2)",
    ]);
    expect(r.payload.data).toEqual([
      [0, 1, 2, 3, 4],
      [10, null, null, null, null],
      [null, 20, null, 40, null],
    ]);
  });

  // P1.4 (P4-4): the SAME parity fixture shape, but the group channel now
  // carries a level table — series labels should read the STRING level.
  // Backend counterpart: test_calc_plotting.py
  // test_build_grouped_series_uses_level_labels_for_a_categorical_group_col.
  it("a categorical group channel uses its string level labels, not the raw code", () => {
    const catData: DataStruct = {
      time: [0, 1, 2, 3],
      values: [
        [10, 0],
        [20, 1],
        [30, 0],
        [40, 1],
      ],
      labels: ["Value", "Region"],
      units: ["V", ""],
      metadata: {},
      cat_levels: { 1: ["North", "South"] },
    };
    const catDs: Dataset = { id: "c1", name: "cat.dat", data: catData };
    const r = specToRender(
      spec(null, [{ datasetId: "c1", channel: 0 }], "scatter", { datasetId: "c1", channel: 1 }),
      [catDs],
    );
    expect(r.kind).toBe("xy");
    if (r.kind !== "xy") return;
    expect(r.payload.series.map((s) => s.label)).toEqual([
      "Value (Region=North)",
      "Value (Region=South)",
    ]);
  });

  it("nominal X + continuous Y → box stats grouped by the category", () => {
    const r = specToRender(spec(ref(2), [ref(1)], "box"), [DS]);
    expect(r.kind).toBe("box");
    if (r.kind !== "box") return;
    expect(r.boxes).toHaveLength(2);
    expect(r.valueLabel).toBe("y");
    expect(r.groupLabel).toBe("grp");
    expect(r.violin).toBe(false);
    // group 0 = rows with grp 0 → y in 10..20 → median 15
    expect(r.boxes[0].median).toBe(15);
    expect(r.boxes[1].median).toBe(35);
  });

  // P1.4 (P4-4 closing sentence): the box/bar categorical gate is
  // `isCategorical(channelModelingType(...))`; channelModelingType now
  // defaults a cat_levels channel to "nominal" (lib/modeling.ts), so a
  // categorical channel is box-groupable with NO channelTypes override —
  // even one too small/irregular for the numeric-shape inference to catch.
  it("a P1.4 categorical X channel is box-groupable with no channelTypes override", () => {
    const catData: DataStruct = {
      time: [0, 1, 2, 3],
      values: [
        [0, 10],
        [1, 20],
        [0, 30],
        [1, 40],
      ],
      labels: ["Lot", "y"],
      units: ["", ""],
      metadata: {},
      cat_levels: { 0: ["L1", "L2"] }, // only 4 rows, 2 levels — below inferModelingType's MIN_SAMPLES
    };
    const catDs: Dataset = { id: "c2", name: "cat2.dat", data: catData };
    const r = specToRender(spec({ datasetId: "c2", channel: 0 }, [{ datasetId: "c2", channel: 1 }], "box"), [catDs]);
    expect(r.kind).toBe("box");
    if (r.kind !== "box") return;
    expect(r.boxes).toHaveLength(2);
    expect(r.groupLabel).toBe("Lot");
  });

  it("violin mark renders as box stats offline, flagged for the caller", () => {
    const r = specToRender(spec(ref(2), [ref(1)], "violin"), [DS]);
    expect(r.kind).toBe("box");
    if (r.kind !== "box") return;
    expect(r.violin).toBe(true);
  });

  it("nominal X + continuous Y, bar mark → a bar chart matrix (gap #20)", () => {
    const r = specToRender(spec(ref(2), [ref(1)], "bar"), [DS]);
    expect(r.kind).toBe("bar");
    if (r.kind !== "bar") return;
    expect(r.data.groups).toHaveLength(2); // grp levels 0 and 1
    expect(r.data.seriesLabels).toEqual(["y"]);
    expect(r.valueLabel).toBe("y");
    expect(r.groupLabel).toBe("grp");
    expect(r.stacked).toBe(false);
    // group 0 = rows with grp 0 → y in 10..20 → mean 15
    expect(r.data.groups[0].series[0].mean).toBeCloseTo(15, 10);
    expect(r.data.groups[1].series[0].mean).toBeCloseTo(35, 10);
  });

  it("bar mark with multiple Y channels → one series per channel per category", () => {
    const r = specToRender(spec(ref(2), [ref(1), ref(0)], "bar"), [DS]);
    expect(r.kind).toBe("bar");
    if (r.kind !== "bar") return;
    expect(r.data.seriesLabels).toEqual(["y", "x"]);
    expect(r.valueLabel).toBe("value"); // multi-series: no single value label
    expect(r.data.groups[0].series).toHaveLength(2);
  });

  it("bar mark with a non-categorical X is a note (bar needs a category axis)", () => {
    const r = specToRender(spec(ref(0), [ref(1)], "bar"), [DS]);
    expect(r).toMatchObject({ kind: "message", tone: "note" });
  });

  it("a facet channel splits the xy payload into one panel per level (gap #21)", () => {
    const r = specToRender(spec(ref(0), [ref(1)], "scatter", null, ref(2)), [DS]);
    expect(r.kind).toBe("xy");
    if (r.kind !== "xy") return;
    expect(r.facets).toBeDefined();
    expect(r.facets).toHaveLength(2); // grp levels 0 and 1
    expect(r.facets?.[0].payload.data[0]).toHaveLength(6); // 6 rows per level
  });

  it("omits facets entirely when zones.facet is unset (untouched path)", () => {
    const r = specToRender(spec(ref(0), [ref(1)], "scatter"), [DS]);
    expect(r.kind).toBe("xy");
    if (r.kind !== "xy") return;
    expect(r.facets).toBeUndefined();
  });

  // ── Box/Violin/Bar faceting (GUI_INTERACTION #11) ─────────────────────────
  describe("box/bar faceting", () => {
    it("box: one box set per facet level, dropping a level with no finite groups", () => {
      const s = spec(ref(0, "d3"), [ref(1, "d3")], "box", null, ref(2, "d3"));
      const r = specToRender(s, [FACET_DS]);
      expect(r.kind).toBe("box");
      if (r.kind !== "box") return;
      // The flat fallback field is unaffected — still computed from ALL rows.
      expect(r.boxes).toHaveLength(2);
      expect(r.facets).toBeDefined();
      expect(r.facets).toHaveLength(2); // levels "0"/"1" kept, "2" dropped
      expect(r.facets?.map((f) => f.label)).toEqual(["0", "1"]);
      expect(r.facets?.[0].boxes).toHaveLength(2); // grp 0 and 1 within fac=0
      expect(r.facets?.[1].boxes).toHaveLength(2);
      expect(r.facets?.[0].boxes[0].median).toBe(12); // fac=0, grp=0 -> y 10,12,14
      expect(r.facets?.[1].boxes[0].median).toBe(112); // fac=1, grp=0 -> y 110,112,114
    });

    it("violin mark carries the same facets shape as box (offline degrade)", () => {
      const s = spec(ref(0, "d3"), [ref(1, "d3")], "violin", null, ref(2, "d3"));
      const r = specToRender(s, [FACET_DS]);
      expect(r.kind).toBe("box");
      if (r.kind !== "box") return;
      expect(r.violin).toBe(true);
      expect(r.facets).toHaveLength(2);
    });

    it("bar: one matrix per facet level, same drop rule", () => {
      const s = spec(ref(0, "d3"), [ref(1, "d3")], "bar", null, ref(2, "d3"));
      const r = specToRender(s, [FACET_DS]);
      expect(r.kind).toBe("bar");
      if (r.kind !== "bar") return;
      expect(r.data.groups).toHaveLength(2); // flat fallback unaffected
      expect(r.facets).toBeDefined();
      expect(r.facets).toHaveLength(2);
      expect(r.facets?.map((f) => f.label)).toEqual(["0", "1"]);
      expect(r.facets?.[0].data.groups).toHaveLength(2);
      expect(r.facets?.[0].data.groups[0].series[0].mean).toBeCloseTo(12, 10); // fac=0, grp=0
      expect(r.facets?.[1].data.groups[0].series[0].mean).toBeCloseTo(112, 10); // fac=1, grp=0
    });

    it("omits facets entirely when zones.facet is unset (regression)", () => {
      const s = spec(ref(0, "d3"), [ref(1, "d3")], "box");
      const r = specToRender(s, [FACET_DS]);
      expect(r.kind).toBe("box");
      if (r.kind !== "box") return;
      expect(r.facets).toBeUndefined();
    });
  });

  // ── Error wells (#51 phase 3): the same data + pairing the mini-preview
  // draws from — GraphPreview just draws whatever this computes. ───────────
  describe("errorSpans", () => {
    it("carries yErr/xErr as ErrorSpans, keyed like buildErrorSpans (p+1)", () => {
      const s = spec(eref(3), [eref(0)], "scatter", null, null, [eref(1)], eref(3));
      const r = specToRender(s, [ERR_DS]);
      expect(r.kind).toBe("xy");
      if (r.kind !== "xy") return;
      expect(r.errorSpans).toBeDefined();
      const ySpan = r.errorSpans!.get(1)!.find((sp) => sp.axis === "y")!;
      expect(ySpan.plus).toEqual([0.1, 0.2, 0.3]);
      expect(ySpan.minus).toEqual([0.1, 0.2, 0.3]);
      const xSpan = r.errorSpans!.get(1)!.find((sp) => sp.axis === "x")!;
      expect(xSpan.plus).toEqual([0.01, 0.02, 0.03]);
    });

    it("omits errorSpans when no wells are set (untouched path)", () => {
      const r = specToRender(spec(ref(0), [ref(1)], "scatter"), [DS]);
      expect(r.kind).toBe("xy");
      if (r.kind !== "xy") return;
      expect(r.errorSpans).toBeUndefined();
    });

    it("omits errorSpans for a grouped spec (no sound 1:1 mapping to synthetic per-level series)", () => {
      const s = spec(null, [eref(0)], "scatter", eref(2), null, [eref(1)]);
      const r = specToRender(s, [ERR_DS]);
      expect(r.kind).toBe("xy");
      if (r.kind !== "xy") return;
      expect(r.grouped).toBe(true);
      expect(r.errorSpans).toBeUndefined();
    });
  });

  it("an empty spec is an incomplete hint", () => {
    expect(specToRender(emptySpec(), [DS])).toMatchObject({ kind: "message", tone: "hint" });
  });

  it("a spec whose dataset is not loaded is a note", () => {
    const r = specToRender(spec(ref(0, "gone"), [ref(1, "gone")], "scatter"), [DS]);
    expect(r).toMatchObject({ kind: "message", tone: "note" });
  });

  it("honors the analysis view (excluded rows drop out) — guard #11", () => {
    const withExcl: Dataset = { ...DS, excludedRows: [0, 1, 2] }; // drop 3 rows of grp 0
    const r = specToRender(spec(ref(0), [ref(1)], "scatter"), [withExcl]);
    expect(r.kind).toBe("xy");
    if (r.kind !== "xy") return;
    expect(r.payload.data[0]).toHaveLength(9); // 12 − 3
    const box = specToRender(spec(ref(2), [ref(1)], "box"), [withExcl]);
    if (box.kind !== "box") throw new Error("expected box");
    expect(box.boxes[0].n).toBe(3); // grp 0 kept only 3 rows (16,18,20)
    expect(box.boxes[0].median).toBe(18);
  });
});

// ── Serialization round-trip ─────────────────────────────────────────────────
describe("serialize / deserialize / validate", () => {
  it("round-trips a full spec", () => {
    const s = spec(ref(0), [ref(1), ref(2)], "violin", ref(2));
    s.zones.facet = ref(1);
    const back = deserializePlotSpec(serializePlotSpec(s));
    expect(back).toEqual(s);
  });

  it("validatePlotSpec rejects an unsupported version (1 and 2 are both valid now)", () => {
    // A version-2 TAG with no v2 block content is tolerated (and normalizes
    // back down to version 1 — see the "recomputes version" tests below);
    // only a genuinely unknown version number is rejected.
    expect(validatePlotSpec({ version: 99, zones: {}, mark: "scatter" })).toBeNull();
    expect(validatePlotSpec({ version: 0, zones: {}, mark: "scatter" })).toBeNull();
    expect(validatePlotSpec(null)).toBeNull();
    expect(validatePlotSpec("nope")).toBeNull();
  });

  it("accepts an incoming version of 1 or 2", () => {
    expect(validatePlotSpec({ version: 1, zones: {}, mark: "scatter" })).not.toBeNull();
    expect(validatePlotSpec({ version: 2, zones: {}, mark: "scatter" })).not.toBeNull();
  });

  it("normalizes a bad mark to scatter and drops malformed Y refs", () => {
    const v = validatePlotSpec({
      version: 1,
      zones: { x: ref(0), y: [ref(1), { datasetId: "d1" }, 5, null], group: null, facet: null },
      mark: "wobble",
    });
    expect(v).not.toBeNull();
    expect(v!.mark).toBe("scatter");
    expect(v!.zones.y).toEqual([ref(1)]);
  });

  it("deserialize returns null for malformed JSON", () => {
    expect(deserializePlotSpec("{not json")).toBeNull();
  });

  // ── stepMode / showMarkers (GAP_PLOTTYPES): byte-stable v1 siblings of
  // `mark`, tolerantly validated like every other field, round-tripping
  // without promoting the spec to version 2. ─────────────────────────────
  it("round-trips stepMode + showMarkers, staying version 1", () => {
    const s: PlotSpec = { ...spec(ref(0), [ref(1)], "step"), stepMode: "mid", showMarkers: true };
    const raw = serializePlotSpec(s);
    expect(JSON.parse(raw).version).toBe(1);
    const back = deserializePlotSpec(raw);
    expect(back).toEqual(s);
  });

  it("normalizes a bad stepMode/showMarkers, dropping them rather than nulling the spec", () => {
    const v = validatePlotSpec({
      version: 1,
      zones: { x: ref(0), y: [ref(1)], group: null, facet: null },
      mark: "step",
      stepMode: "diagonal",
      showMarkers: "yes",
    });
    expect(v).not.toBeNull();
    expect(v!.stepMode).toBeUndefined();
    expect(v!.showMarkers).toBeUndefined();
  });

  it("omits stepMode/showMarkers entirely from a spec that never set them (no JSON noise)", () => {
    const raw = serializePlotSpec(spec(ref(0), [ref(1)], "line"));
    expect(JSON.parse(raw)).not.toHaveProperty("stepMode");
    expect(JSON.parse(raw)).not.toHaveProperty("showMarkers");
  });

  // ── yErr/xErr (#51 phase 3) — tolerant validation ─────────────────────────
  it("emptySpec() initializes yErr/xErr", () => {
    expect(emptySpec().zones.yErr).toEqual([]);
    expect(emptySpec().zones.xErr).toBeNull();
  });

  it("round-trips yErr/xErr through serialize -> deserialize", () => {
    const s = spec(ref(0), [ref(1), ref(2)], "line", null, null, [ref(3)], ref(4));
    const back = deserializePlotSpec(serializePlotSpec(s));
    expect(back).toEqual(s);
  });

  it("truncates a yErr longer than y — a trailing entry has no y to describe", () => {
    const v = validatePlotSpec({
      version: 1,
      zones: { x: ref(0), y: [ref(1)], group: null, facet: null, yErr: [ref(2), ref(3)], xErr: null },
      mark: "scatter",
    });
    expect(v!.zones.yErr).toEqual([ref(2)]);
  });

  it("drops duplicate yErr refs", () => {
    const v = validatePlotSpec({
      version: 1,
      zones: {
        x: ref(0),
        y: [ref(1), ref(9)],
        group: null,
        facet: null,
        yErr: [ref(2), ref(2)],
        xErr: null,
      },
      mark: "scatter",
    });
    expect(v!.zones.yErr).toEqual([ref(2)]);
  });

  it("drops malformed yErr entries and a malformed xErr, rather than nulling the spec", () => {
    const v = validatePlotSpec({
      version: 1,
      zones: {
        x: ref(0),
        y: [ref(1)],
        group: null,
        facet: null,
        yErr: [ref(2), { datasetId: "d1" }, 5, null],
        xErr: "not a ref",
      },
      mark: "scatter",
    });
    expect(v).not.toBeNull();
    expect(v!.zones.yErr).toEqual([ref(2)]);
    expect(v!.zones.xErr).toBeNull();
  });

  it("tolerates a spec with no yErr/xErr keys at all (pre-#51-phase-3 payload)", () => {
    const v = validatePlotSpec({
      version: 1,
      zones: { x: ref(0), y: [ref(1)], group: null, facet: null },
      mark: "scatter",
    });
    expect(v!.zones.yErr).toEqual([]);
    expect(v!.zones.xErr).toBeNull();
  });
});

// ── PlotSpec v2 (GUI_INTERACTION_PLAN #12, Slice 2) ─────────────────────────
describe("PlotSpec v2 — schema, up-convert, byte-stability", () => {
  // TODAY's exact v1 output shape — the byte-stability contract every
  // existing saved spec / .dwk payload depends on. #51 phase 3 widened
  // `zones` with yErr/xErr, always present at their empty default (the SAME
  // "every zone field is always serialized, even as null/[]" convention
  // x/group/facet already use) — this literal was updated ONCE, deliberately,
  // for that widening. If it ever needs to change again, something else broke
  // back-compat.
  const V1_FIXTURE =
    '{"version":1,"zones":{"x":{"datasetId":"d1","channel":-1},"y":[{"datasetId":"d1","channel":0}],"group":null,"facet":null,"yErr":[],"xErr":null},"mark":"line"}';
  // A genuinely OLD persisted payload — no yErr/xErr keys at all, exactly
  // what a pre-#51-phase-3 .dwk/macro actually has on disk.
  const LEGACY_V1_FIXTURE =
    '{"version":1,"zones":{"x":{"datasetId":"d1","channel":-1},"y":[{"datasetId":"d1","channel":0}],"group":null,"facet":null},"mark":"line"}';

  it("a v1 fixture string round-trips through load -> serialize byte-identical", () => {
    const loaded = validatePlotSpec(JSON.parse(V1_FIXTURE));
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.display).toBeUndefined();
    expect(loaded!.axes).toBeUndefined();
    expect(serializePlotSpec(loaded!)).toBe(V1_FIXTURE);
  });

  it("a legacy pre-#51-phase-3 payload (no yErr/xErr keys) loads and re-serializes to today's canonical shape", () => {
    const loaded = validatePlotSpec(JSON.parse(LEGACY_V1_FIXTURE));
    expect(loaded).not.toBeNull();
    expect(loaded!.zones.yErr).toEqual([]);
    expect(loaded!.zones.xErr).toBeNull();
    expect(serializePlotSpec(loaded!)).toBe(V1_FIXTURE);
  });

  it("emptySpec() still serializes as version 1 (unaffected by v2 existing)", () => {
    expect(emptySpec().version).toBe(1);
    expect(JSON.parse(serializePlotSpec(emptySpec())).version).toBe(1);
  });

  it("a plain zone/mark edit (no v2 content) never promotes to version 2", () => {
    const s = spec(ref(0), [ref(1), ref(2)], "scatter", ref(2), ref(1));
    expect(JSON.parse(serializePlotSpec(s)).version).toBe(1);
  });

  it("a v2 spec with display + axes content round-trips losslessly and serializes as version 2", () => {
    const s: PlotSpec = {
      ...spec(ref(0), [ref(1)], "scatter"),
      display: { series: { 1: { color: "#ff8800", width: 2, marker: true } }, order: [1, 0] },
      axes: { x: { label: "Field", lim: [0, 10] }, title: "My graph" },
    };
    const raw = serializePlotSpec(s);
    expect(JSON.parse(raw).version).toBe(2);
    const back = deserializePlotSpec(raw);
    expect(back).toEqual({ ...s, version: 2 });
  });

  it("a v2 spec with decor content ('part C') round-trips losslessly and serializes as version 2", () => {
    const s: PlotSpec = {
      ...spec(ref(0), [ref(1)], "scatter"),
      decor: {
        annotations: [{ id: "a1", x: 1, y: 2, text: "peak" }],
        shapes: [{ id: "s1", kind: "arrow", x1: 0, y1: 0, x2: 1, y2: 1 }],
        legend: { pos: "sw", xy: [0.2, 0.8], title: "Nb/Au" },
      },
    };
    const raw = serializePlotSpec(s);
    expect(JSON.parse(raw).version).toBe(2);
    const back = deserializePlotSpec(raw);
    expect(back).toEqual({ ...s, version: 2 });
  });

  it("a display/axes block present but empty of content does not promote to version 2", () => {
    const v = validatePlotSpec({
      version: 2,
      zones: {},
      mark: "scatter",
      display: { series: {}, order: [] },
      axes: { x: {} },
    });
    expect(v).not.toBeNull();
    expect(v!.version).toBe(1);
    expect(v!.display).toBeUndefined();
    expect(v!.axes).toBeUndefined();
  });

  it("malformed display/axes fields drop per-field, never null the whole spec", () => {
    const v = validatePlotSpec({
      version: 2,
      zones: { x: ref(0), y: [ref(1)], group: null, facet: null },
      mark: "scatter",
      display: { series: { 0: { color: "#fff", markerShape: "hexagon" }, "1.5": { color: "#000" } } },
      axes: { x: { label: "Field", lim: [0, NaN] }, y: { scale: "bogus" } },
    });
    expect(v).not.toBeNull();
    expect(v!.version).toBe(2); // display.series.0.color survives
    expect(v!.display).toEqual({ series: { 0: { color: "#fff" } } });
    expect(v!.axes).toEqual({ x: { label: "Field" } }); // bad lim dropped, bad y.scale drops y entirely
  });

  it("unrecognized page keys drop out and never promote to v2 (#54 pass C)", () => {
    // Was "reserved page content is stripped entirely" before pass C gave the
    // block real fields. The outcome is unchanged for GARBAGE input — every
    // unknown key drops, leaving an empty block that fails the content gate —
    // but it now happens via a real validator rather than an unconditional
    // strip, so a spec cannot smuggle unvalidated page content through.
    const v = validatePlotSpec({
      version: 2,
      zones: { x: ref(0), y: [ref(1)], group: null, facet: null },
      mark: "scatter",
      page: { anything: "goes here", nested: { a: 1 } },
    });
    expect(v).not.toBeNull();
    expect(v!.page).toBeUndefined();
    expect(v!.version).toBe(1);
    expect("page" in v!).toBe(false);
  });

  it("real page content is validated and counts toward v2 promotion (#54 pass C)", () => {
    const v = validatePlotSpec({
      version: 1, // incoming tag is advisory — recomputed from block content
      zones: { x: ref(0), y: [ref(1)], group: null, facet: null },
      mark: "scatter",
      page: {
        stack: true,
        fit: "page",
        setup: { width: 8.5, height: 11, unit: "in", margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5 } },
      },
    });
    expect(v).not.toBeNull();
    expect(v!.version).toBe(2);
    expect(v!.page).toEqual({
      stack: true,
      fit: "page",
      setup: {
        width: 8.5,
        height: 11,
        unit: "in",
        margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5 },
        aspectDerived: false,
      },
    });
  });

  it("drops a malformed page field without discarding the rest of the block", () => {
    const v = validatePlotSpec({
      version: 2,
      zones: { x: ref(0), y: [ref(1)], group: null, facet: null },
      mark: "scatter",
      page: { stack: true, fit: "not-a-fit-mode", setup: { width: -3, height: 11, unit: "in" } },
    });
    expect(v).not.toBeNull();
    expect(v!.version).toBe(2);
    expect(v!.page!.stack).toBe(true);
    expect(v!.page!.fit).toBeUndefined(); // unknown enum value -> field dropped
    // ...but `setup` is CLAMPED, not dropped: it reuses the shared `.dwk`
    // sanitizer rather than a second validator. See plotspec2.test.ts.
    expect(v!.page!.setup).toMatchObject({ width: 0.01, height: 11, unit: "in" });
  });

  it("round-trips a page block through serialize -> parse", () => {
    const spec = validatePlotSpec({
      version: 2,
      zones: { x: ref(0), y: [ref(1)], group: null, facet: null },
      mark: "line",
      page: { stack: true, fit: "window" },
    })!;
    const back = deserializePlotSpec(serializePlotSpec(spec));
    expect(back).toEqual(spec);
    expect(back!.page).toEqual({ stack: true, fit: "window" });
  });

  it("decor (annotations/shapes/legend, 'part C') is validated for real and counts toward v2 promotion", () => {
    const v = validatePlotSpec({
      version: 2,
      zones: { x: ref(0), y: [ref(1)], group: null, facet: null },
      mark: "scatter",
      decor: { annotations: [{ id: "a1", x: 1, y: 2, text: "peak" }], legend: { pos: "sw" } },
    });
    expect(v).not.toBeNull();
    expect(v!.version).toBe(2);
    expect(v!.decor).toEqual({
      annotations: [{ id: "a1", x: 1, y: 2, text: "peak" }],
      legend: { pos: "sw" },
    });
  });

  it("an empty/malformed decor block never promotes to version 2", () => {
    const v = validatePlotSpec({
      version: 2,
      zones: { x: ref(0), y: [ref(1)], group: null, facet: null },
      mark: "scatter",
      decor: { legend: "fancy" }, // legend must be an object — drops entirely
    });
    expect(v).not.toBeNull();
    expect(v!.version).toBe(1);
    expect(v!.decor).toBeUndefined();
  });

  it("an unknown version number is rejected regardless of otherwise-valid content", () => {
    expect(
      validatePlotSpec({
        version: 3,
        zones: {},
        mark: "scatter",
        display: { series: { 0: { color: "#fff" } } },
      }),
    ).toBeNull();
  });
});

// ── Saved specs (GUI_INTERACTION_PLAN #11) ──────────────────────────────────
describe("plotSpecsEqual", () => {
  it("true for structurally identical specs, even with different field order", () => {
    const a = spec(ref(0), [ref(1), ref(2)], "scatter");
    const b: PlotSpec = {
      mark: "scatter",
      zones: { y: [ref(1), ref(2)], x: ref(0), group: null, facet: null, yErr: [], xErr: null },
      version: 1,
    };
    expect(plotSpecsEqual(a, b)).toBe(true);
  });

  it("false when a zone or the mark differs", () => {
    const a = spec(ref(0), [ref(1)], "scatter");
    expect(plotSpecsEqual(a, spec(ref(0), [ref(2)], "scatter"))).toBe(false);
    expect(plotSpecsEqual(a, spec(ref(0), [ref(1)], "line"))).toBe(false);
  });

  it("true for two empty specs", () => {
    expect(plotSpecsEqual(emptySpec(), emptySpec())).toBe(true);
  });

  it("true between a v1 spec and a version-2-tagged spec carrying only empty/all-default v2 blocks (GUI_INTERACTION #12)", () => {
    const a = spec(ref(0), [ref(1)], "scatter");
    const b: PlotSpec = {
      version: 2,
      zones: { x: ref(0), y: [ref(1)], group: null, facet: null, yErr: [], xErr: null },
      mark: "scatter",
      display: { series: {}, order: [] },
      axes: { x: {}, y: {} },
    };
    expect(plotSpecsEqual(a, b)).toBe(true);
  });

  it("false once a v2 block carries actual content", () => {
    const a = spec(ref(0), [ref(1)], "scatter");
    const b: PlotSpec = {
      ...spec(ref(0), [ref(1)], "scatter"),
      display: { series: { 1: { color: "#ff8800" } } },
    };
    expect(plotSpecsEqual(a, b)).toBe(false);
  });
});

// GUI_INTERACTION_PLAN #12 Slice 3 — the Graph Builder's dirty-dot switched
// from plotSpecsEqual to this: it must ignore v2 block content entirely,
// which is exactly what a save-time block capture (useGraphBuilder's
// captureLiveBlocks) needs (see plotSpecCoreEqual's own doc for the false-
// dirty trap this closes).
describe("plotSpecCoreEqual", () => {
  it("true for identical zones+mark even when one side carries v2 blocks the other lacks", () => {
    const a = spec(ref(0), [ref(1)], "scatter");
    const b: PlotSpec = {
      ...spec(ref(0), [ref(1)], "scatter"),
      display: { series: { 1: { color: "#ff8800", width: 3 } } },
      axes: { x: { label: "Field" } },
    };
    expect(plotSpecCoreEqual(a, b)).toBe(true);
  });

  it("stays true even when the two sides' blocks disagree with each other", () => {
    const a: PlotSpec = {
      ...spec(ref(0), [ref(1)], "scatter"),
      display: { series: { 1: { color: "#ff0000" } } },
    };
    const b: PlotSpec = {
      ...spec(ref(0), [ref(1)], "scatter"),
      display: { series: { 1: { color: "#00ff00" } } },
    };
    expect(plotSpecCoreEqual(a, b)).toBe(true);
  });

  it("false when a zone or the mark differs, exactly like plotSpecsEqual", () => {
    const a = spec(ref(0), [ref(1)], "scatter");
    expect(plotSpecCoreEqual(a, spec(ref(0), [ref(2)], "scatter"))).toBe(false);
    expect(plotSpecCoreEqual(a, spec(ref(0), [ref(1)], "line"))).toBe(false);
  });

  it("true for two empty specs", () => {
    expect(plotSpecCoreEqual(emptySpec(), emptySpec())).toBe(true);
  });

  it("false when stepMode or showMarkers differ (GAP_PLOTTYPES — these ARE core, unlike v2 blocks)", () => {
    const a: PlotSpec = { ...spec(ref(0), [ref(1)], "step"), stepMode: "post" };
    const b: PlotSpec = { ...spec(ref(0), [ref(1)], "step"), stepMode: "mid" };
    expect(plotSpecCoreEqual(a, b)).toBe(false);
    const c: PlotSpec = { ...spec(ref(0), [ref(1)], "line"), showMarkers: true };
    const d: PlotSpec = spec(ref(0), [ref(1)], "line");
    expect(plotSpecCoreEqual(c, d)).toBe(false);
  });

  it("false when yErr or xErr differ (#51 phase 3 — the wells are core zone content)", () => {
    const a = spec(ref(0), [ref(1)], "line", null, null, [ref(2)]);
    const b = spec(ref(0), [ref(1)], "line", null, null, [ref(3)]);
    expect(plotSpecCoreEqual(a, b)).toBe(false);
    const c = spec(ref(0), [ref(1)], "line", null, null, [], ref(4));
    const d = spec(ref(0), [ref(1)], "line");
    expect(plotSpecCoreEqual(c, d)).toBe(false);
  });
});

describe("sanitizeSavedPlotSpecs", () => {
  const saved = (id: string): SavedPlotSpec => ({
    id,
    name: `graph ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    spec: spec(ref(0), [ref(1)], "scatter"),
  });

  it("passes through a well-formed list, normalizing each spec", () => {
    const out = sanitizeSavedPlotSpecs([saved("a"), saved("b")]);
    expect(out).toEqual([saved("a"), saved("b")]);
  });

  it("returns [] for a non-array input", () => {
    expect(sanitizeSavedPlotSpecs(null)).toEqual([]);
    expect(sanitizeSavedPlotSpecs("nope")).toEqual([]);
    expect(sanitizeSavedPlotSpecs(undefined)).toEqual([]);
  });

  it("drops an entry missing id/name/createdAt/modifiedAt", () => {
    const out = sanitizeSavedPlotSpecs([saved("a"), { id: "b" }, { name: "no id" }]);
    expect(out.map((s) => s.id)).toEqual(["a"]);
  });

  it("drops an entry whose spec is structurally impossible, keeps the rest", () => {
    const out = sanitizeSavedPlotSpecs([saved("a"), { ...saved("b"), spec: "not an object" }]);
    expect(out.map((s) => s.id)).toEqual(["a"]);
  });

  it("normalizes (not drops) a spec with a bad mark/refs — validatePlotSpec is tolerant", () => {
    const out = sanitizeSavedPlotSpecs([{ ...saved("a"), spec: { version: 1, zones: {}, mark: "bogus" } }]);
    expect(out).toHaveLength(1);
    expect(out[0].spec).toEqual(emptySpec());
  });
});
