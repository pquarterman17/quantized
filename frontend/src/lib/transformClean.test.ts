// Clean data transforms (lib/transformClean.ts): dedupe, fill/drop missing,
// z-score / min-max / rank — the maths, the refusals, and the recorded replay
// through lib/transformRun (one derived worksheet, source untouched).

import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../store/useApp";
import { cleanParamsOf, computeClean, type CleanParams } from "./transformClean";
import { computeTransform, runTransform, transformParamsOf, transformStepText } from "./transformRun";
import type { DataStruct, Dataset } from "./types";

const N = Number.NaN;
const sheet = (rows: number[][], metadata: Record<string, unknown> = {}, extra: Partial<DataStruct> = {}): DataStruct => ({
  time: rows.map((r) => r[0]),
  values: rows.map((r) => r.slice(1)),
  labels: ["a", "b"],
  units: ["K", "emu"],
  metadata,
  ...extra,
});
const run = (p: CleanParams, data: DataStruct) => computeClean(p, { name: "src.dat", data });

describe("dedupe", () => {
  const data = sheet([[1, 5, 1], [2, 6, 2], [1, 5, 1], [3, 5, 3], [2, 6, 9]]);

  it("whole-row: drops exact repeats only, keeping the first and the original order", () => {
    const r = run({ op: "dedupe", keys: [], keep: "first" }, data);
    expect(r.data.time).toEqual([1, 2, 3, 2]);
    expect(r.data.values).toEqual([[5, 1], [6, 2], [5, 3], [6, 9]]);
    expect(r.warnings.map((w) => w.text)).toEqual(["Removed 1 duplicate row (kept the first of each group)."]);
    expect(r.name).toBe("src (deduplicated)");
  });

  it("by key column keeps the last, in row order, and warns that differing rows lose values", () => {
    const r = run({ op: "dedupe", keys: [-1], keep: "last" }, data);
    expect(r.data.time).toEqual([1, 3, 2]);
    expect(r.data.values).toEqual([[5, 1], [5, 3], [6, 9]]);
    const conflict = r.warnings.find((w) => w.code === "dedupe-conflict");
    expect(conflict?.count).toBe(1); // x=2 differs (2 vs 9); x=1 rows are identical
    expect(conflict?.info).toBeUndefined();
  });

  it("treats NaN keys as equal and aligns text sidecars to the kept rows", () => {
    const d = sheet([[1, N, 0], [2, N, 0], [3, 4, 0]], { text_columns: { who: ["a", "b", "c"] } });
    const r = run({ op: "dedupe", keys: [0], keep: "first" }, d);
    expect(r.data.time).toEqual([1, 3]);
    expect(r.data.metadata.text_columns).toEqual({ who: ["a", "c"] });
  });

  it("can key on a text column, and refuses a key the dataset does not have", () => {
    const d = sheet([[1, 1, 1], [2, 2, 2], [3, 3, 3]], { text_columns: { who: ["a", "a", "b"] } });
    expect(run({ op: "dedupe", keys: ["who"], keep: "first" }, d).data.time).toEqual([1, 3]);
    expect(() => run({ op: "dedupe", keys: ["nope"], keep: "first" }, d)).toThrow(/text column "nope"/);
    expect(() => run({ op: "dedupe", keys: [7], keep: "first" }, d)).toThrow(/column 8 is not in this dataset/);
  });

  it("says so when nothing was a duplicate", () => {
    const r = run({ op: "dedupe", keys: [], keep: "first" }, sheet([[1, 1, 1], [2, 2, 2]]));
    expect(r.data.time).toEqual([1, 2]);
    expect(r.warnings[0].text).toMatch(/No duplicate rows/);
  });
});

describe("fillmissing", () => {
  const gappy = sheet([[0, 0, 1], [1, N, N], [2, N, 3], [4, 8, N], [5, N, N]]);

  it("linear: interpolates on X between present values, never extrapolates, and counts what it left", () => {
    const r = run({ op: "fillmissing", method: "linear", channels: [0, 1] }, gappy);
    expect(r.data.values.map((v) => v[0])).toEqual([0, 2, 4, 8, N]);
    expect(r.data.values.map((v) => v[1])).toEqual([1, 2, 3, N, N]);
    expect(r.warnings.find((w) => w.code === "clean")?.count).toBe(3);
    expect(r.warnings.find((w) => w.code === "gaps-unfilled")?.count).toBe(3);
  });

  it("linear: an X that does not bracket the gap, or has a zero span, is left blank", () => {
    const d = sheet([[1, 0, 0], [1, N, 0], [1, 2, 0], [3, N, 0], [2, 6, 0]]);
    const r = run({ op: "fillmissing", method: "linear", channels: [0] }, d);
    expect(r.data.values.map((v) => v[0])).toEqual([0, N, 2, N, 6]);
  });

  it("previous carries forward and leaves a leading gap blank", () => {
    const r = run({ op: "fillmissing", method: "previous", channels: [0] }, sheet([[0, N, 0], [1, 4, 0], [2, N, 0]]));
    expect(r.data.values.map((v) => v[0])).toEqual([N, 4, 4]);
    expect(r.warnings.find((w) => w.code === "gaps-unfilled")?.count).toBe(1);
  });

  it("drop removes rows missing in any chosen column and keeps text sidecars aligned", () => {
    const d = sheet([[0, 1, N], [1, N, 2], [2, 3, 4]], { text_columns: { id: ["x", "y", "z"] } });
    const r = run({ op: "fillmissing", method: "drop", channels: [0] }, d);
    expect(r.data.time).toEqual([0, 2]);
    expect(r.data.metadata.text_columns).toEqual({ id: ["x", "z"] });
    // column 1 not chosen: row 0's NaN there does not drop it
    expect(r.warnings[0].text).toMatch(/Dropped 1 row/);
  });

  it("refuses to drop every row, and to interpolate a categorical column", () => {
    expect(() => run({ op: "fillmissing", method: "drop", channels: [0] }, sheet([[0, N, 0], [1, N, 0]]))).toThrow(/nothing/);
    const cat = sheet([[0, 0, 1], [1, N, 1]], {}, { cat_levels: { 0: ["u", "v"] } });
    expect(() => run({ op: "fillmissing", method: "linear", channels: [0] }, cat)).toThrow(/categorical/);
    expect(run({ op: "fillmissing", method: "previous", channels: [0] }, cat).data.values[1][0]).toBe(0);
  });

  it("never fills over an infinity", () => {
    const r = run({ op: "fillmissing", method: "linear", channels: [0] }, sheet([[0, 1, 0], [1, Infinity, 0], [2, N, 0], [3, 5, 0]]));
    expect(r.data.values.map((v) => v[0])).toEqual([1, Infinity, N, 5]);
  });
});

describe("standardize", () => {
  const data = sheet([[0, 2, 10], [1, 4, 10], [2, N, 30], [3, 6, 20]]);

  it("z-score uses the sample SD, keeps NaN, relabels and clears the unit", () => {
    const r = run({ op: "standardize", method: "zscore", channels: [0] }, data);
    expect(r.data.values.map((v) => v[0])).toEqual([-1, 0, N, 1]);
    expect(r.data.labels).toEqual(["a (z-score)", "b"]);
    expect(r.data.units).toEqual(["", "emu"]);
    expect(r.data.values.map((v) => v[1])).toEqual([10, 10, 30, 20]); // other columns untouched
    expect(r.warnings.some((w) => /1 blank cell stayed blank/.test(w.text))).toBe(true);
  });

  it("min-max maps to 0..1", () => {
    const r = run({ op: "standardize", method: "minmax", channels: [1] }, data);
    expect(r.data.values.map((v) => v[1])).toEqual([0, 0, 1, 0.5]);
  });

  it("rank is 1-based with tied values sharing their average rank", () => {
    const r = run({ op: "standardize", method: "rank", channels: [1] }, data);
    expect(r.data.values.map((v) => v[1])).toEqual([1.5, 1.5, 4, 3]);
  });

  it("refuses a constant column, a single value, a categorical column and a missing column", () => {
    const flat = sheet([[0, 5, 1], [1, 5, 2]]);
    expect(() => run({ op: "standardize", method: "zscore", channels: [0] }, flat)).toThrow(/constant/);
    expect(() => run({ op: "standardize", method: "minmax", channels: [0] }, flat)).toThrow(/constant/);
    expect(() => run({ op: "standardize", method: "zscore", channels: [0] }, sheet([[0, 5, 1]]))).toThrow(/constant or has fewer/);
    const cat = sheet([[0, 0, 1], [1, 1, 2]], {}, { cat_levels: { 0: ["u", "v"] } });
    expect(() => run({ op: "standardize", method: "rank", channels: [0] }, cat)).toThrow(/categorical/);
    expect(() => run({ op: "standardize", method: "rank", channels: [5] }, flat)).toThrow(/column 6/);
  });
});

describe("recorded params", () => {
  it("validates what a template/.dwk carries, with refusals", () => {
    expect(cleanParamsOf({ op: "dedupe", keys: [-1, "who"], keep: "last" })).toEqual({ op: "dedupe", keys: [-1, "who"], keep: "last" });
    expect(cleanParamsOf({ op: "dedupe" })).toEqual({ op: "dedupe", keys: [], keep: "first" });
    expect(cleanParamsOf({ op: "fillmissing", method: "drop", channels: [1, 0, 1] })).toEqual({ op: "fillmissing", method: "drop", channels: [0, 1] });
    expect(() => cleanParamsOf({ op: "dedupe", keep: "middle" })).toThrow(/duplicate rule/);
    expect(() => cleanParamsOf({ op: "dedupe", keys: [-2] })).toThrow(/keys/);
    expect(() => cleanParamsOf({ op: "fillmissing", method: "cubic", channels: [0] })).toThrow(/fill method/);
    expect(() => cleanParamsOf({ op: "fillmissing", method: "drop", channels: [] })).toThrow(/channels/);
    expect(() => cleanParamsOf({ op: "standardize", method: "log", channels: [0] })).toThrow(/standardize method/);
    expect(() => transformParamsOf({ op: "standardize", method: "rank", channels: [0.5] })).toThrow(/channels/);
  });
});

describe("through the transform runner", () => {
  const S: Dataset = { id: "S", name: "src.dat", data: sheet([[1, 5, 1], [1, 5, 1], [2, N, 3]]) };
  beforeEach(() => {
    useApp.setState({ datasets: [S], activeId: "S", selectedIds: ["S"], macroRecording: true, macroSteps: [], status: "" });
  });
  const created = () => useApp.getState().datasets.filter((d) => d.id !== "S");

  it("computeTransform previews without creating anything", async () => {
    const c = await computeTransform({ op: "dedupe", keys: [], keep: "first" }, S, []);
    expect(c.data.time).toEqual([1, 2]);
    expect(c.preview.summary).toBe("Result: 2 rows × 2 columns (plus X).");
    expect(created()).toEqual([]);
  });

  it("creates one derived worksheet, leaves the source alone, records a replayable step", async () => {
    const before = useApp.getState().datasets[0].data;
    const out = await runTransform(useApp.getState, { op: "fillmissing", method: "drop", channels: [0] }, "S");
    expect(out?.name).toBe("src (missing dropped)");
    expect(created()).toHaveLength(1);
    expect(created()[0].data.metadata.worksheet_transform).toBe("fillmissing");
    expect(useApp.getState().datasets.find((d) => d.id === "S")?.data).toBe(before);
    const step = useApp.getState().macroSteps.at(-1);
    expect(step?.kind).toBe("transform");
    expect(step?.params).toMatchObject({ op: "fillmissing", method: "drop", channels: [0], inputIsTarget: true });
    // replay through the recorded params
    const again = await runTransform(useApp.getState, transformParamsOf(step!.params as Record<string, unknown>), "S");
    expect(again?.name).toBe("src (missing dropped)");
    expect(created()).toHaveLength(2);
  });

  it("a refusal creates nothing and records nothing", async () => {
    await expect(runTransform(useApp.getState, { op: "standardize", method: "zscore", channels: [9] }, "S")).rejects.toThrow(/column 10/);
    expect(created()).toEqual([]);
    expect(useApp.getState().macroSteps).toEqual([]);
  });

  it("labels the pipeline step", () => {
    expect(transformStepText({ op: "dedupe", keys: [], keep: "first" }, "src").label).toBe("Remove duplicate rows (keep first) · src");
    expect(transformStepText({ op: "standardize", method: "rank", channels: [0] }, "src").code).toContain('"standardize"');
  });
});
