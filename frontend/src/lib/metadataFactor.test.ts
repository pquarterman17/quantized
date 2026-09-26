// P2.5 "Metadata → factors": which fields a selection carries (metadataKeys)
// and the promotion plan + column it produces (metadataFactor) — text,
// numeric, missing, the type override and every refusal.

import { describe, expect, it } from "vitest";

import { applyFormulas, baseColumns } from "./formula";
import { factorColumn, numericOf, planFactor } from "./metadataFactor";
import { keysAcross, metaValue, scalarFields } from "./metadataKeys";
import type { DataStruct } from "./types";

const ds = (id: string, metadata: Record<string, unknown>, labels = ["M"]) => ({
  id,
  name: `${id}.dat`,
  data: { time: [1, 2, 3], values: [[1], [2], [3]].map((r) => r.slice(0, labels.length)), labels, units: labels.map(() => ""), metadata } as DataStruct,
});

describe("metadata keys", () => {
  it("lists top-level and one-level-nested scalars, with per-dataset coverage", () => {
    const a = ds("a", { sample: "S1", x_column_name: "H", comments: ["# x"], instrument: { SAMPLE_MASS: "7.2", nested: { deep: 1 } } });
    const b = ds("b", { sample: "S2", operator: "pq", wafer: "" });
    const keys = keysAcross([a, b]);
    expect(keys.map((k) => [k.label, k.ids])).toEqual([
      ["sample", ["a", "b"]],
      ["operator", ["b"]],
      ["instrument › SAMPLE_MASS", ["a"]],
    ]);
    // wiring and collections never offered; a blank value is not coverage
    expect(scalarFields(a.data.metadata).map(([p]) => p.join("."))).not.toContain("x_column_name");
    expect(metaValue(a.data.metadata, ["instrument", "SAMPLE_MASS"])).toBe("7.2");
    expect(metaValue(a.data.metadata, ["instrument", "nested"])).toBeUndefined();
  });
});

describe("planFactor", () => {
  it("text values promote as categorical: every row gets its dataset's level", () => {
    const targets = [ds("a", { sample: "S1" }), ds("b", { sample: "S2" })];
    const plan = planFactor(targets, ["sample"], "auto", "sample");
    expect(plan.as).toBe("categorical");
    expect(plan.blocked).toBeNull();
    expect(plan.rows.map((r) => r.cell)).toEqual(["S1", "S2"]);
    const col = factorColumn(plan, plan.rows[1], ["sample"]);
    expect(col).toMatchObject({ name: "sample", expr: "0", deps: [], factor: { source: "metadata", path: ["sample"], as: "categorical", value: "S2", levels: ["S2"] } });
    const out = applyFormulas(baseColumns(targets[1].data, 0), [col]);
    expect(out.labels).toEqual(["M", "sample"]);
    expect(out.values.map((r) => r[1])).toEqual([0, 0, 0]);
    expect(out.cat_levels?.[1]).toEqual(["S2"]);
  });

  it("numbers (and plain numeric text) promote as numeric, with a parsed unit when one is recorded", () => {
    const targets = [ds("a", { T_set: 300, T_set_unit: "K" }), ds("b", { T_set: " 1e1 " })];
    const plan = planFactor(targets, ["T_set"], "auto", "T");
    expect(plan.as).toBe("numeric");
    expect(plan.rows.map((r) => [r.cell, r.unit])).toEqual([["300", "K"], ["10", ""]]);
    const col = factorColumn(plan, plan.rows[0], ["T_set"]);
    expect(col).toMatchObject({ expr: "300", unit: "K" });
    expect(col.factor?.levels).toBeUndefined();
    const out = applyFormulas(baseColumns(targets[0].data, 0), [col]);
    expect(out.values.map((r) => r[1])).toEqual([300, 300, 300]);
    expect(out.units[1]).toBe("K");
    expect(out.cat_levels?.[1]).toBeUndefined();
    expect(numericOf("300 K")).toBeNull();
    expect(plan.unitsDiffer).toEqual(["K", ""]); // reported, each column keeps its own
    expect(planFactor([ds("a", { T: 1, T_unit: "K" }), ds("b", { T: 2, T_unit: "K" })], ["T"], "auto", "T").unitsDiffer).toEqual([]);
  });

  it("a missing value is blank (NaN) and reported, never defaulted", () => {
    const targets = [ds("a", { sample: "S1" }), ds("b", {}), ds("c", { sample: "  " })];
    const plan = planFactor(targets, ["sample"], "auto", "sample");
    expect(plan.blocked).toBeNull();
    expect(plan.missing).toEqual(["b.dat", "c.dat"]);
    const col = factorColumn(plan, plan.rows[1], ["sample"]);
    expect(col).toMatchObject({ expr: "0/0", factor: { value: null, levels: [] } });
    const out = applyFormulas(baseColumns(targets[1].data, 0), [col]);
    expect(out.values.every((r) => Number.isNaN(r[1]))).toBe(true);
    // numeric missing is NaN too
    const num = planFactor([ds("a", { T: 5 }), ds("b", {})], ["T"], "auto", "T");
    expect(factorColumn(num, num.rows[1], ["T"]).expr).toBe("0/0");
  });

  it("the type override wins; numeric refuses text rather than inventing NaN", () => {
    const targets = [ds("a", { run: 3 }), ds("b", { run: 4 })];
    expect(planFactor(targets, ["run"], "categorical", "run").rows.map((r) => r.cell)).toEqual(["3", "4"]);
    const text = planFactor([ds("a", { run: "3" }), ds("b", { run: "four" })], ["run"], "numeric", "run");
    expect(text.blocked).toMatch(/“four” in b\.dat is not a number/);
  });

  it("refuses a name clash, an empty name, and a field no dataset has", () => {
    expect(planFactor([ds("a", { M: "x" })], ["M"], "auto", "m").blocked).toMatch(/already has a column named “m”/);
    expect(planFactor([ds("a", { s: "x" })], ["s"], "auto", "  ").blocked).toMatch(/Name the new column/);
    expect(planFactor([ds("a", {})], ["s"], "auto", "s").blocked).toMatch(/No picked dataset has a value/);
    // a replay onto one file without the field: blank + reported, not refused
    const replay = planFactor([ds("a", {})], ["s"], "categorical", "s", true);
    expect([replay.blocked, replay.missing]).toEqual([null, ["a.dat"]]);
  });
});
