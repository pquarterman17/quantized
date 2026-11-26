import { describe, expect, it } from "vitest";

import wire from "../../../tests/fixtures/wire/point_label_avoid_cluster.json";
import { AVOID_MAX_LABELS, GRID_X, GRID_Y, layoutMessage, layoutPointLabels, pointLabelsViewRefusal, type LabelInputs, type LabelViewState } from "./pointLabelLayout";
import { DEFAULT_LABEL_AVOID } from "./pointLabelAvoid";
import { labelText } from "./pointLabelText";
import { MAX_ALL_POINTS, MAX_LABEL_CHARS, sanitizePointLabels } from "./pointLabels";
import type { DataStruct } from "./types";

const VIEW: LabelViewState = { xScale: "linear", yScale: "linear", exchangeXY: false, waterfall: 0, waterfallDx: 0, horizontalBars: false, split: false };

/** x = time; channel 0 = y, channel 1 = label column (numeric ids). */
function data(ys: number[], ids?: number[], extra: Partial<DataStruct> = {}): DataStruct {
  return {
    time: ys.map((_, i) => i),
    values: ys.map((y, i) => [y, ids ? ids[i] : 100 + i]),
    labels: ["y", "id"],
    units: ["", ""],
    metadata: {},
    ...extra,
  };
}

function inputs(d: DataStruct, over: Partial<LabelInputs> = {}): LabelInputs {
  return {
    dataset: { data: d, columnDesignations: undefined },
    dropped: new Set(),
    xKey: null,
    channels: [0],
    logOffset: false,
    view: VIEW,
    spec: { key: 1, mode: "all", topN: 10 },
    selected: null,
    ...over,
  };
}

describe("labelText", () => {
  it("prints a number to 6 significant digits and a category by its name", () => {
    expect(labelText(data([1], [3.14159265]), 1, 0)).toBe("3.14159");
    const cat = data([1, 2], [1, 0], { cat_levels: { 1: ["wafer A", "wafer B"] } });
    expect(labelText(cat, 1, 0)).toBe("wafer B");
    expect(labelText(cat, 1, 1)).toBe("wafer A");
  });
  it("is null for a missing value or a blank category, and cuts long text", () => {
    expect(labelText(data([1], [NaN]), 1, 0)).toBeNull();
    expect(labelText(data([1], [0], { cat_levels: { 1: ["  "] } }), 1, 0)).toBeNull();
    const long = "x".repeat(100);
    const t = labelText(data([1], [0], { cat_levels: { 1: [long] } }), 1, 0) as string;
    expect(t).toHaveLength(MAX_LABEL_CHARS);
    expect(t.endsWith("…")).toBe(true);
  });
});

describe("layoutPointLabels", () => {
  it("all: labels every point with its label value and dataset row", () => {
    const out = layoutPointLabels(inputs(data([5, 9, 1, 7])));
    expect(out.refusal).toBeNull();
    expect(out.points.map((p) => [p.row, p.text]).sort()).toEqual([[0, "100"], [1, "101"], [2, "102"], [3, "103"]]);
    expect(out.note).toBeNull();
  });

  it("never labels excluded or filtered rows (the dropped set), nor blank or non-finite points", () => {
    const d = data([5, 9, 1, 7, NaN], [1, 2, 3, NaN, 5]);
    const out = layoutPointLabels(inputs(d, { dropped: new Set([1]) }));
    // row 1 dropped, row 3 has a blank label, row 4 has a NaN y
    expect(out.points.map((p) => p.row).sort()).toEqual([0, 2]);
  });

  it("top: the N points furthest from zero in |y|, negative values included", () => {
    const d = data([1, -9, 3, 7, -2, 0.5]);
    const out = layoutPointLabels(inputs(d, { spec: { key: 1, mode: "top", topN: 3 } }));
    expect(out.points.map((p) => p.row)).toEqual([1, 3, 2]);
  });

  it("top: a dropped row can never fill a slot", () => {
    const d = data([100, 1, 2, 3]);
    const out = layoutPointLabels(inputs(d, { dropped: new Set([0]), spec: { key: 1, mode: "top", topN: 2 } }));
    expect(out.points.map((p) => p.row)).toEqual([3, 2]);
  });

  it("selected: only the selected rows; none selected says so and draws nothing", () => {
    const d = data([5, 9, 1, 7]);
    const some = layoutPointLabels(inputs(d, { spec: { key: 1, mode: "selected", topN: 10 }, selected: new Set([0, 2, 99]) }));
    expect(some.points.map((p) => p.row).sort()).toEqual([0, 2]);
    const none = layoutPointLabels(inputs(d, { spec: { key: 1, mode: "selected", topN: 10 }, selected: new Set() }));
    expect(none.points).toEqual([]);
    expect(layoutMessage(none)).toMatch(/No rows selected/);
    // a selected row that is also excluded stays unlabelled
    const ex = layoutPointLabels(inputs(d, { spec: { key: 1, mode: "selected", topN: 10 }, selected: new Set([0, 2]), dropped: new Set([2]) }));
    expect(ex.points.map((p) => p.row)).toEqual([0]);
  });

  it("thins crowded labels to one per grid cell, keeping the largest |y|, and says how many were left out", () => {
    // 50 points stacked within one cell of a wide plot (the extent comes from the two far points)
    const ys = [0, 100, ...Array.from({ length: 50 }, (_, i) => 50 + i * 0.001)];
    const d: DataStruct = { ...data(ys), time: [0, 100, ...Array.from({ length: 50 }, (_, i) => 50 + i * 0.001)] };
    const out = layoutPointLabels(inputs(d));
    const crowd = out.points.filter((p) => p.row >= 2);
    expect(crowd).toHaveLength(1);
    expect(crowd[0].row).toBe(51); // the largest y of the crowd
    expect(out.points.length).toBeLessThanOrEqual(GRID_X * GRID_Y);
    expect(out.note).toBe(`3 of 52 labels drawn; 49 crowded labels left out`);
  });

  describe("Avoid overlaps reaches the layout (#1039 acceptance defect)", () => {
    // 30 clustered points (the acceptance setup): one tight clump plus a few far ones.
    const xs = [...Array.from({ length: 26 }, (_, i) => 5 + (i % 5) * 0.05), 9, 9.1, 1, 2];
    const ys = [...Array.from({ length: 26 }, (_, i) => 5 + Math.floor(i / 5) * 0.05), 10, 9.6, 1.5, 2.5];
    const d: DataStruct = { ...data(ys), time: xs };
    const top30 = { key: 1, mode: "top" as const, topN: 30 };

    it("off: the grid still thins the clump, with its note", () => {
      const out = layoutPointLabels(inputs(d, { spec: top30 }));
      expect(out.points.length).toBeLessThan(30);
      expect(out.note).toMatch(/crowded labels? left out/);
    });
    it("on: every wanted label is kept (placement moves them), none dropped, no thinning note", () => {
      const out = layoutPointLabels(inputs(d, { spec: { ...top30, avoid: DEFAULT_LABEL_AVOID } }));
      expect(out.points).toHaveLength(30);
      expect(out.note).toBeNull();
    });
    it("on: the layout equals the shared wire fixture the export test feeds to matplotlib", () => {
      const fx = wire as { dataset: { x: number[]; y: number[]; id: number[] }; spec: { topN: number }; wire_points: { x: number; y: number; text: string; s: number }[] };
      const fd: DataStruct = { ...data(fx.dataset.y, fx.dataset.id), time: fx.dataset.x };
      const out = layoutPointLabels(inputs(fd, { spec: { key: 1, mode: "top", topN: fx.spec.topN, avoid: DEFAULT_LABEL_AVOID } }));
      expect(out.points.map(({ x, y, text, s }) => ({ x, y, text, s }))).toEqual(fx.wire_points);
    });
    it("on: past the placement cap the grid thins again, and says so", () => {
      const n = AVOID_MAX_LABELS + 50;
      const big: DataStruct = { ...data(Array.from({ length: n }, (_, i) => 1 + (i % 7) * 0.001)), time: Array.from({ length: n }, (_, i) => 5 + (i % 11) * 0.001) };
      const out = layoutPointLabels(inputs(big, { spec: { key: 1, mode: "all", topN: 10, avoid: DEFAULT_LABEL_AVOID } }));
      expect(out.points.length).toBeLessThan(n);
      expect(out.note).toMatch(/crowded labels? left out/);
    });
  });

  it("is deterministic and independent of the row order of ties", () => {
    const d = data(Array.from({ length: 300 }, (_, i) => Math.sin(i) * 10));
    expect(layoutPointLabels(inputs(d))).toEqual(layoutPointLabels(inputs(d)));
  });

  it("all: refuses above the cap with the reason and draws nothing", () => {
    const d = data(Array.from({ length: MAX_ALL_POINTS + 1 }, (_, i) => i));
    const out = layoutPointLabels(inputs(d));
    expect(out.points).toEqual([]);
    expect(out.refusal).toMatch(/over the 2,000 limit/);
    expect(layoutMessage(out)).toMatch(/^Point labels cannot be drawn/);
    // Top N and Selected rows stay available on the same data
    const top = layoutPointLabels(inputs(d, { spec: { key: 1, mode: "top", topN: 5 } }));
    expect(top.refusal).toBeNull();
    expect(top.points.length).toBeGreaterThan(0); // (the 5 largest sit in one corner cell, so they thin to 1 and say so)
    expect(top.note).toBe("1 of 5 labels drawn; 4 crowded labels left out");
  });

  it("a deleted label column draws nothing and says so", () => {
    const out = layoutPointLabels(inputs(data([1, 2]), { spec: { key: 7, mode: "all", topN: 10 } }));
    expect(out.points).toEqual([]);
    expect(out.refusal).toMatch(/no longer exists/);
  });

  it("log axes skip non-positive values", () => {
    const d = data([10, -5, 0, 1000]);
    const out = layoutPointLabels(inputs(d, { view: { ...VIEW, yScale: "log" } }));
    expect(out.points.map((p) => p.row).sort()).toEqual([0, 3]);
  });

  it("labels each plotted curve at its own point and the label column itself is never a curve", () => {
    const d: DataStruct = { ...data([1, 2]), values: [[1, 7, 10], [2, 8, 20]], labels: ["a", "b", "id"], units: ["", "", ""] };
    const out = layoutPointLabels(inputs(d, { channels: [0, 1, 2], spec: { key: 2, mode: "all", topN: 10 } }));
    expect(out.points.map((p) => [p.row, p.ch, p.s]).sort()).toEqual([[0, 0, 0], [0, 1, 1], [1, 0, 0], [1, 1, 1]]);
  });
});

describe("refusals", () => {
  it.each<[Partial<LabelViewState>, RegExp]>([
    [{ exchangeXY: true }, /exchanged/],
    [{ waterfall: 0.2 }, /waterfall/],
    [{ waterfallDx: 0.1 }, /waterfall/],
    [{ horizontalBars: true }, /horizontal bars/],
    [{ split: true }, /group, encoding, facet or secondary/],
    [{ xScale: "reciprocal" }, /reciprocal/],
  ])("a view that cannot carry the labels (%j) draws none and names why", (patch, re) => {
    expect(pointLabelsViewRefusal({ ...VIEW, ...patch })).toMatch(re);
    const out = layoutPointLabels(inputs(data([1, 2, 3]), { view: { ...VIEW, ...patch } }));
    expect(out.points).toEqual([]);
    expect(out.refusal).toMatch(re);
  });

  it("decade offsets on a log axis and curves on different X columns are refused", () => {
    expect(layoutPointLabels(inputs(data([1, 2]), { logOffset: true })).refusal).toMatch(/decade offsets/);
    // T1, R1, T2, R2: R2 belongs to T2, so one shared X cannot carry both curves.
    const d: DataStruct = { ...data([1, 2]), values: [[1, 7, 3, 9], [2, 8, 4, 6]], labels: ["T1", "R1", "T2", "R2"], units: ["", "", "", ""] };
    const out = layoutPointLabels({
      ...inputs(d, { channels: [1, 3], xKey: null, spec: { key: 0, mode: "all", topN: 3 } }),
      dataset: { data: d, columnDesignations: ["X", "Y", "X", "Y"] },
    });
    expect(out.points).toEqual([]);
    expect(out.refusal).toMatch(/different X columns/);
  });
});

describe("sanitizePointLabels", () => {
  it("keeps a valid setting and clamps topN", () => {
    expect(sanitizePointLabels({ key: 2, mode: "top", topN: 5 })).toEqual({ key: 2, mode: "top", topN: 5 });
    expect(sanitizePointLabels({ key: 2, mode: "all", topN: 9999 })).toEqual({ key: 2, mode: "all", topN: 10 });
  });
  it("fails closed on anything malformed (off)", () => {
    for (const bad of [null, 3, [], {}, { key: -1, mode: "all" }, { key: 1.5, mode: "all" }, { key: "1", mode: "all" }, { key: 1, mode: "everything" }]) {
      expect(sanitizePointLabels(bad)).toBeNull();
    }
  });
});
