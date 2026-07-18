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
  moveYZone,
  plotSpecCoreEqual,
  plotSpecsEqual,
  sanitizeSavedPlotSpecs,
  serializePlotSpec,
  specDatasetId,
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
): PlotSpec {
  return { version: 1, zones: { x, y, group, facet }, mark };
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
  it("offers scatter/line for xy, box/violin/bar for categorical, none for incomplete", () => {
    expect(validMarks(spec(ref(0), [ref(1)], "scatter"), ctx())).toEqual(["scatter", "line"]);
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
  it("cycles scatter ⇄ line", () => {
    const base = spec(ref(0), [ref(1)], "scatter");
    const c = ctx();
    expect(cycleMark({ ...base, mark: "scatter" }, c)).toBe("line");
    expect(cycleMark({ ...base, mark: "line" }, c)).toBe("scatter");
  });
  it("no-ops on an incomplete spec", () => {
    expect(cycleMark(spec(ref(0), [], "scatter"), ctx())).toBe("scatter");
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
});

// ── PlotSpec v2 (GUI_INTERACTION_PLAN #12, Slice 2) ─────────────────────────
describe("PlotSpec v2 — schema, up-convert, byte-stability", () => {
  // The EXACT string a v1 spec has always serialized to — the byte-stability
  // contract every existing saved spec / .dwk payload depends on. If this
  // literal ever needs to change, something broke back-compat.
  const V1_FIXTURE =
    '{"version":1,"zones":{"x":{"datasetId":"d1","channel":-1},"y":[{"datasetId":"d1","channel":0}],"group":null,"facet":null},"mark":"line"}';

  it("a v1 fixture string round-trips through load -> serialize byte-identical", () => {
    const loaded = validatePlotSpec(JSON.parse(V1_FIXTURE));
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.display).toBeUndefined();
    expect(loaded!.axes).toBeUndefined();
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

  it("reserved page/decor content is stripped entirely, without affecting the rest of the spec", () => {
    const v = validatePlotSpec({
      version: 2,
      zones: { x: ref(0), y: [ref(1)], group: null, facet: null },
      mark: "scatter",
      page: { anything: "goes here", nested: { a: 1 } },
      decor: { legend: "fancy" },
    });
    expect(v).not.toBeNull();
    expect(v!.page).toBeUndefined();
    expect(v!.decor).toBeUndefined();
    expect(v!.version).toBe(1); // page/decor never count toward v2 promotion
    expect("page" in v!).toBe(false);
    expect("decor" in v!).toBe(false);
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
    const b: PlotSpec = { mark: "scatter", zones: { y: [ref(1), ref(2)], x: ref(0), group: null, facet: null }, version: 1 };
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
      zones: { x: ref(0), y: [ref(1)], group: null, facet: null },
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
