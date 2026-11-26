import { describe, expect, it } from "vitest";

import { boxColumns, genericBoxCols, mapAxesOf, resolveMapBoxAxes, sameAxes, withValueColumn } from "./mapBoxSpace";
import { mapColumns } from "./mapdataFetch";
import type { DataStruct } from "./types";

// Long-form sheet: X is the row axis, Y/Z/W channels.
const plain: DataStruct = {
  time: [0, 1, 2],
  values: [[10, 1, 5], [11, 2, 6], [12, 3, 7]],
  labels: ["Y", "Z", "W"],
  units: ["", "", ""],
  metadata: { x_column_name: "X" },
};
const rsm: DataStruct = {
  time: [0, 1],
  values: [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6]],
  labels: ["2Theta", "Omega", "Intensity", "Qx", "Qz"],
  units: [],
  metadata: { is2D: true, axis1_name: "Omega" },
};

describe("plain-map box axes", () => {
  it("names the displayed pair and compares by label", () => {
    expect(mapAxesOf(["X", "Y", "Z"], [0, 1, 2])).toEqual(["X", "Y"]);
    expect(mapAxesOf(["X"], [0, 1, 2])).toBeNull();
    expect(sameAxes(["X", "Y"], ["X", "Y"])).toBe(true);
    expect(sameAxes(["X", "Y"], ["X", "Z"])).toBe(false);
    expect(sameAxes(undefined, ["X", "Y"])).toBe(false);
    expect(sameAxes(null, null)).toBe(false);
  });

  it("builds the flat columns from the displayed channels", () => {
    const shown = mapColumns(plain);
    const c = genericBoxCols(shown, [1, 2, 3]);
    expect(Array.from(c.x)).toEqual([10, 11, 12]);
    expect(Array.from(c.y)).toEqual([1, 2, 3]);
    expect(Array.from(c.intensity)).toEqual([5, 6, 7]);
    expect(c.mapShape).toBeNull();
  });

  it("resolves a box's labels to the dataset's own columns", () => {
    expect(resolveMapBoxAxes(plain, ["Y", "Z"])).toEqual({ cols: [0, 1] });
    expect(resolveMapBoxAxes(rsm, ["Omega", "Qx"])).toEqual({ cols: [1, 3] });
  });

  it("refuses the row axis, a missing label, a duplicate label and no axes", () => {
    expect(resolveMapBoxAxes(plain, ["X", "Y"]).error).toMatch(/X column/);
    expect(resolveMapBoxAxes(plain, ["Nope", "Y"]).error).toMatch(/does not have/);
    const dup = { ...plain, labels: ["Y", "Y", "W"] };
    expect(resolveMapBoxAxes(dup, ["Y", "W"]).error).toMatch(/ambiguous/);
    expect(resolveMapBoxAxes(plain, undefined).error).toMatch(/no axes/);
    expect(resolveMapBoxAxes(plain, ["Y", "Y"]).error).toMatch(/same column/);
  });

  it("picks a value column apart from the axes", () => {
    expect(withValueColumn(plain, [0, 1], 2)).toEqual([0, 1, 2]);
    expect(withValueColumn(plain, [0, 1], 1)).toEqual([0, 1, 2]); // collides: first free
    expect(withValueColumn(plain, [0, 1])).toEqual([0, 1, 2]);
    expect(withValueColumn({ ...plain, labels: ["Y", "Z"] }, [0, 1])).toBeNull();
  });

  it("boxColumns: RSM boxes keep their own pair, plain boxes use the labels", () => {
    expect(boxColumns(rsm, { space: "angular", x0: 0, x1: 1, y0: 0, y1: 1 })).toEqual([0, 1, 2]);
    expect(boxColumns(plain, { space: "map", axes: ["Y", "Z"], x0: 0, x1: 1, y0: 0, y1: 1 }, 2)).toEqual([0, 1, 2]);
    expect(boxColumns(plain, { space: "map", axes: ["X", "Z"], x0: 0, x1: 1, y0: 0, y1: 1 })).toEqual(expect.any(String));
  });
});
