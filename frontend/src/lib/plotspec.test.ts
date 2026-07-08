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
  serializePlotSpec,
  specDatasetId,
  specToRender,
  validMarks,
  validatePlotSpec,
  withInferredMark,
  type ChannelRef,
  type MarkContext,
  type PlotSpec,
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

const TYPES: Record<number, ModelingType> = { 0: "continuous", 1: "continuous", 2: "nominal" };
const ctx = (xMonotonic?: boolean): MarkContext => ({
  typeOf: (r) => TYPES[r.channel] ?? "continuous",
  xMonotonic,
});
const ref = (channel: number, datasetId = "d1"): ChannelRef => ({ datasetId, channel });

/** Build a spec from zone refs + mark (test convenience). */
function spec(x: ChannelRef | null, y: ChannelRef[], mark: PlotSpec["mark"], group: ChannelRef | null = null): PlotSpec {
  return { version: 1, zones: { x, y, group, facet: null }, mark };
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

  it("bar mark returns a deferred note", () => {
    const r = specToRender(spec(ref(2), [ref(1)], "bar"), [DS]);
    expect(r).toMatchObject({ kind: "message", tone: "note" });
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

  it("validatePlotSpec rejects a wrong version", () => {
    expect(validatePlotSpec({ version: 2, zones: {}, mark: "scatter" })).toBeNull();
    expect(validatePlotSpec(null)).toBeNull();
    expect(validatePlotSpec("nope")).toBeNull();
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
