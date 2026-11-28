// Which sheets count as similar for "Insert column into similar sheets": labels, units AND designations.

import { describe, expect, it } from "vitest";

import { layoutDifference, similarSheets } from "./similarSheets";
import type { Dataset } from "./types";

const sheet = (id: string, units: string[], extra: Partial<Dataset> = {}): Dataset => ({
  id,
  name: id,
  data: { time: [0], values: [[1, 2]], labels: ["a", "b"], units, metadata: {} },
  ...extra,
});

describe("similarSheets", () => {
  const A = sheet("A", ["V", "s"]);
  it("same labels, units and designations are similar; each difference is named", () => {
    const sets = [A, sheet("same", ["V", "s"]), sheet("units", ["mV", "s"]), sheet("desig", ["V", "s"], { columnDesignations: { 1: "Y-error" } }), sheet("both", ["V", "ms"], { columnDesignations: { 1: "Y-error" } })];
    const r = similarSheets(sets, A);
    expect(r.targets.map((d) => d.id)).toEqual(["A", "same"]);
    expect(r.differs.map((x) => [x.ds.id, x.reason])).toEqual([
      ["units", "not similar: units differ"],
      ["desig", "not similar: designations differ"],
      ["both", "not similar: units and designations differ"],
    ]);
  });
  it("includeDifferent adds them to the targets; a blank unit equals a missing one", () => {
    const sets = [A, sheet("units", ["mV", "s"])];
    expect(similarSheets(sets, A, true).targets.map((d) => d.id)).toEqual(["A", "units"]);
    expect(layoutDifference(sheet("x", ["", ""]), sheet("y", [" ", ""]))).toBeNull();
  });
  it("a protected sheet stays refused even when included", () => {
    const sets = [A, sheet("p", ["mV", "s"], { protectedSheet: true })];
    const r = similarSheets(sets, A, true);
    expect(r.targets.map((d) => d.id)).toEqual(["A"]);
    expect(r.refused[0]!.ds.id).toBe("p");
  });
});
