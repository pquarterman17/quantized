import { describe, expect, it } from "vitest";

import { extractionColumns, getMapPick, pickProblem, setMapPick } from "./mapPick";
import type { DataStruct } from "./types";

const ds = (labels: string[], metadata: Record<string, unknown> = {}): DataStruct => ({
  time: [0],
  values: [labels.map(() => 0)],
  labels,
  units: [],
  metadata,
});

describe("extractionColumns mirrors the backend's default columns", () => {
  it("takes the two non-value columns when there are exactly two", () => {
    expect(extractionColumns(ds(["Qx", "Qz", "Intensity"]))).toEqual([0, 1]);
    expect(extractionColumns(ds(["a", "b", "c"]))).toEqual([0, 1]); // value = last
    expect(extractionColumns(ds(["I", "x", "Intensity", "y"]))).toBeNull();
  });
  it("falls back to 2Theta and the named second axis, else refuses", () => {
    const rsm = ds(["2Theta", "Omega", "Intensity", "Qx", "Qz"], { axis1_name: "Omega" });
    expect(extractionColumns(rsm)).toEqual([0, 1]);
    expect(extractionColumns(ds(["2Theta", "Omega", "Intensity", "Qx", "Qz"]))).toBeNull();
    expect(extractionColumns(ds(["a", "b"]))).toBeNull();
  });
});

describe("pickProblem", () => {
  const rsm = ds(["2Theta", "Omega", "Intensity", "Qx", "Qz"], { is2D: true, axis1_name: "Omega" });
  it("accepts the maps' own axes and refuses any other view with a reason", () => {
    expect(pickProblem(rsm, [0, 1, 2])).toBeNull();
    expect(pickProblem(rsm, [3, 4, 2])).toMatch(/2Theta and Omega/);
    expect(pickProblem(rsm, [1, 0, 2])).not.toBeNull();
  });
  it("accounts for the prepended row-axis column of a plain sheet", () => {
    const sheet = ds(["Y", "Z", "W"]); // values columns 0,1 are the axes; displayed keys are shifted by one
    expect(pickProblem(sheet, [1, 2, 3])).toBeNull();
    expect(pickProblem(sheet, [0, 1, 2])).not.toBeNull(); // the row axis is not a value column
  });
  it("refuses a map whose axes extraction cannot choose", () => {
    expect(pickProblem(ds(["a", "b"], { is2D: true }), [0, 1, 2])).toMatch(/cannot choose/);
  });
});

describe("the pick store", () => {
  it("holds the last pick and clears", () => {
    setMapPick({ x: 1, y: 2, axes: ["a", "b"] });
    expect(getMapPick()).toEqual({ x: 1, y: 2, axes: ["a", "b"] });
    setMapPick(null);
    expect(getMapPick()).toBeNull();
  });
});
