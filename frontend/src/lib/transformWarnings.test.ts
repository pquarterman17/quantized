// P2.5 transform-safety analyzers. Each count is checked against a hand-built
// fixture AND, where the transform can say it too, against the transform's
// own output — so an analyzer that drifts from what the operation actually
// does (first-row-wins, NaN outside B's range) goes red here.

import { describe, expect, it } from "vitest";

import { mergeDatasets } from "./merge";
import {
  actionable,
  analyzeAlgebra,
  analyzeJoin,
  analyzeMerge,
  analyzeSplit,
  analyzeStack,
  analyzeTranspose,
  analyzeUnstack,
  needsConfirm,
  stampWarnings,
  warningsText,
} from "./transformWarnings";
import type { DataStruct } from "./types";
import { joinWorksheets } from "./worksheetTransforms";

const ds = (time: number[], cols: number[][], labels: string[], units: string[], metadata = {}): DataStruct => ({
  time,
  values: time.map((_, r) => cols.map((c) => c[r])),
  labels,
  units,
  metadata,
});

const codes = (w: { code: string }[]) => w.map((x) => x.code);

describe("analyzeJoin", () => {
  // left key column 0: 1, 2, 2 (dup), NaN (blank), 3, 5 (unmatched)
  const left = ds([0, 1, 2, 3, 4, 5], [[1, 2, 2, NaN, 3, 5], [10, 20, 21, 30, 40, 50]], ["T", "a"], ["K", ""]);
  // right key column 0: 1, 1 (dup), 2, 4 (unmatched)
  const right = ds([0, 1, 2, 3], [[1, 1, 2, 4], [7, 8, 9, 10]], ["T", "b"], ["K", ""]);

  it("counts duplicate, blank and unmatched keys per side for an inner join", () => {
    const w = analyzeJoin(left, right, 0, 0, "inner", "L", "R");
    const byCode = (c: string, name: string) => w.find((x) => x.code === c && x.text.startsWith(name));
    expect(byCode("duplicate-keys", "L")?.count).toBe(1);
    expect(byCode("duplicate-keys", "R")?.count).toBe(1);
    expect(byCode("blank-keys", "L")?.count).toBe(1);
    expect(byCode("blank-keys", "R")).toBeUndefined();
    // Left keys {1,2,3,5} vs right {1,2,4}: 3 and 5 unmatched on the left, 4 on the right.
    expect(byCode("unmatched-dropped", "L")?.count).toBe(2);
    expect(byCode("unmatched-dropped", "R")?.count).toBe(1);
    expect(needsConfirm(w)).toBe(false);
  });

  it("the row accounting adds up against the join's real output", () => {
    const out = joinWorksheets(left, right, 0, 0, "inner");
    const w = analyzeJoin(left, right, 0, 0, "inner", "L", "R");
    const lost = (name: string) =>
      w.filter((x) => x.text.startsWith(name)).reduce((n, x) => n + (x.count ?? 0), 0);
    // Every left row is kept, or a duplicate, or blank, or unmatched.
    expect(out.time.length + lost("L")).toBe(left.time.length);
    expect(out.time.length + lost("R")).toBe(right.time.length);
  });

  it("a left join drops only the RIGHT side's unmatched keys; a full join drops none", () => {
    const l = analyzeJoin(left, right, 0, 0, "left", "L", "R");
    expect(l.find((x) => x.code === "unmatched-dropped")?.text).toMatch(/^R:/);
    expect(l.find((x) => x.code === "unmatched-blank")?.text).toMatch(/^L:/);
    const f = analyzeJoin(left, right, 0, 0, "full", "L", "R");
    expect(codes(f)).not.toContain("unmatched-dropped");
    expect(f.filter((x) => x.code === "unmatched-blank").every((x) => x.info)).toBe(true);
  });

  it("flags differing key units for an explicit confirm, naming both columns", () => {
    const r2 = { ...right, units: ["mK", ""] };
    const w = analyzeJoin(left, r2, 0, 0, "inner", "L", "R");
    const u = w.find((x) => x.code === "unit-mismatch");
    expect(u?.confirm).toBe(true);
    expect(u?.text).toContain("K");
    expect(u?.text).toContain("mK");
    expect(needsConfirm(w)).toBe(true);
  });

  it("reads the X unit from metadata when X is the key, and an unknown unit is not a mismatch", () => {
    const a = ds([1, 2], [[0, 0]], ["v"], [""], { x_column_unit: "s" });
    const b = ds([1, 2], [[0, 0]], ["v"], [""], { x_column_unit: "ms" });
    const c = ds([1, 2], [[0, 0]], ["v"], [""]);
    expect(needsConfirm(analyzeJoin(a, b, -1, -1, "inner", "A", "B"))).toBe(true);
    expect(needsConfirm(analyzeJoin(a, c, -1, -1, "inner", "A", "C"))).toBe(false);
  });

  it("says nothing for a clean one-to-one join", () => {
    const a = ds([0, 1], [[1, 2]], ["k"], [""]);
    expect(analyzeJoin(a, a, 0, 0, "inner", "A", "B")).toEqual([]);
  });
});

describe("analyzeMerge (append by position)", () => {
  const a = ds([1, 2], [[1, 2], [3, 4]], ["M", "T"], ["emu", "K"], { x_column_unit: "Oe" });

  it("flags a per-column unit mismatch for confirm and names the column", () => {
    const b = ds([3], [[5], [6]], ["M", "T"], ["A m2", "K"], { x_column_unit: "Oe" });
    const w = analyzeMerge([a, b], ["a.dat", "b.dat"]);
    const u = w.find((x) => x.code === "unit-mismatch");
    expect(u?.confirm).toBe(true);
    expect(u?.columns).toEqual(["M"]);
    expect(u?.text).toContain("emu");
    expect(u?.text).toContain("b.dat");
  });

  it("flags an X unit mismatch and a label mismatch (label is not a confirm)", () => {
    const b = ds([3], [[5], [6]], ["Moment", "T"], ["emu", "K"], { x_column_unit: "T" });
    const w = analyzeMerge([a, b], ["a.dat", "b.dat"]);
    expect(w.find((x) => x.code === "unit-mismatch")?.text).toContain("X is Oe");
    const l = w.find((x) => x.code === "label-mismatch");
    expect(l?.confirm).toBeUndefined();
    expect(l?.columns).toEqual(["M"]);
    expect(l?.text).toContain('"Moment"');
  });

  it("is silent for matching inputs, case-only label differences and missing units", () => {
    const b = ds([3], [[5], [6]], ["m", "t"], ["", "K"], { x_column_unit: "Oe" });
    expect(analyzeMerge([a, b], ["a", "b"])).toEqual([]);
    // and mergeDatasets itself agrees the shapes line up
    expect(mergeDatasets([a, b], ["a", "b"]).time).toHaveLength(3);
  });
});

describe("analyzeAlgebra", () => {
  const a = ds([0, 1, 2, 3, 4, 5], [[1, 1, 1, 1, 1, 1]], ["A"], ["K"]);

  it("counts A rows outside B's finite x-range (they come out blank)", () => {
    // B's usable support is x in [1, 3] (x=4 has a NaN y and does not count).
    const b = ds([1, 2, 3, 4], [[1, 2, 3, NaN]], ["B"], ["K"]);
    const w = analyzeAlgebra(a, b, "A-B", "a", "b");
    const r = w.find((x) => x.code === "out-of-range");
    expect(r?.count).toBe(3); // x = 0, 4, 5
    expect(r?.text).toContain("[1, 3]");
  });

  it("every row is blank when B has fewer than 2 usable points", () => {
    const b = ds([1, 2], [[1, NaN]], ["B"], ["K"]);
    expect(analyzeAlgebra(a, b, "A-B", "a", "b").find((x) => x.code === "out-of-range")?.count).toBe(6);
  });

  it("a Y unit mismatch needs confirm for A-B but only informs for A/B", () => {
    const b = ds([0, 5], [[1, 1]], ["B"], ["T"]);
    expect(needsConfirm(analyzeAlgebra(a, b, "A-B", "a", "b"))).toBe(true);
    expect(needsConfirm(analyzeAlgebra(a, b, "(A-B)/(A+B)", "a", "b"))).toBe(true);
    const div = analyzeAlgebra(a, b, "A/B", "a", "b");
    expect(needsConfirm(div)).toBe(false);
    expect(codes(div)).toContain("label-mismatch");
  });

  it("names the unit label the backend actually writes for each op", () => {
    const b = ds([0, 5], [[1, 1]], ["B"], ["T"]);
    const text = (op: string) => analyzeAlgebra(a, b, op, "a", "b")[0].text;
    expect(text("A-B")).toContain('labelled "K"');
    expect(text("(A-B)/(A+B)")).toContain('labelled "asymmetry"');
    expect(text("A/B")).toContain('labelled "ratio"');
    expect(text("A*B")).toContain('labelled "K²"');
  });

  it("an X unit mismatch always needs confirm", () => {
    const ax = { ...a, metadata: { x_column_unit: "Oe" } };
    const bx = ds([0, 5], [[1, 1]], ["B"], ["K"], { x_column_unit: "T" });
    expect(needsConfirm(analyzeAlgebra(ax, bx, "A*B", "a", "b"))).toBe(true);
  });
});

describe("analyzeStack / analyzeUnstack / analyzeTranspose", () => {
  it("stacking channels with different units needs confirm", () => {
    const d = ds([0], [[1], [2], [3]], ["M", "H", "M2"], ["emu", "Oe", "emu"]);
    const w = analyzeStack(d, [0, 1, 2]);
    expect(w[0].confirm).toBe(true);
    expect(w[0].columns).toEqual(["M", "M2", "H"]);
    expect(analyzeStack(d, [0, 2])).toEqual([]);
  });

  it("unstack counts dropped rows and aggregated cells", () => {
    // key col0, category col1, value col2
    const d = ds([0, 1, 2, 3, 4], [[1, 1, 1, NaN, 2], [0, 0, 1, 0, 0], [5, 6, 7, 8, NaN]], ["k", "c", "v"], ["", "", ""]);
    const w = analyzeUnstack(d, 0, 1, 2, "mean");
    expect(w.find((x) => x.code === "rows-dropped")?.count).toBe(2); // NaN key, NaN value
    const agg = w.find((x) => x.code === "aggregated");
    expect(agg?.count).toBe(2); // cell (1,0) holds rows 0 and 1
    expect(agg?.text).toContain("averaged");
    expect(analyzeUnstack(d, 0, 1, 2, "first").find((x) => x.code === "aggregated")?.text).toContain("first row");
  });

  it("transpose reports dropped units as info only", () => {
    const d = ds([0], [[1], [2]], ["a", "b"], ["K", ""]);
    const w = analyzeTranspose(d);
    expect(w[0].info).toBe(true);
    expect(actionable(w)).toEqual([]);
  });
});

describe("analyzeSplit", () => {
  it("counts the rows that fall into the '(other)' group", () => {
    const w = analyzeSplit([{ value: 1, rowIndexes: [0, 1] }, { value: Number.NaN, rowIndexes: [2, 3, 4] }], "T");
    expect(w[0].code).toBe("missing-split-key");
    expect(w[0].count).toBe(3);
    expect(w[0].text).toContain('"T"');
    expect(analyzeSplit([{ value: 1, rowIndexes: [0] }], "T")).toEqual([]);
  });
});

describe("report helpers", () => {
  it("stamps the warnings beside worksheet_transform, overriding an inherited one", () => {
    const d = ds([0], [[1]], ["a"], [""], { worksheet_transform: "stack", source: "x.dat" });
    const out = stampWarnings(d, "merge", [{ code: "label-mismatch", text: "names differ" }]);
    expect(out.metadata).toEqual({ worksheet_transform: "merge", source: "x.dat", transform_warnings: ["names differ"] });
    expect(stampWarnings(d, "merge", []).metadata.transform_warnings).toEqual([]);
  });

  it("renders one line per warning under the summary", () => {
    expect(warningsText("Result: 1 row", [{ code: "blank-keys", text: "x" }, { code: "aggregated", text: "y" }])).toBe(
      "Result: 1 row\n• x\n• y",
    );
  });
});
