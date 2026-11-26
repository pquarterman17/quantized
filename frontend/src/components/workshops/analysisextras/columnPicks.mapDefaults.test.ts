// mapDefaults: a gridding result (columns x, y, Intensity, no axis names) picks x, y and the
// value channel, not the X axis and the first two columns.

import { describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { mapDefaults } from "./columnPicks";

const ds = (labels: string[], metadata: Record<string, unknown>): Dataset => ({
  id: "m",
  name: "m",
  data: { time: [0], values: [labels.map(() => 0)], labels, units: labels.map(() => ""), metadata },
});

describe("mapDefaults", () => {
  it("a native grid map without axis names: the two other columns are X and Y", () => {
    expect(mapDefaults(ds(["x", "y", "Intensity"], { is2D: true }))).toEqual([0, 1, 2]);
    expect(mapDefaults(ds(["Qx", "Qz", "Intensity"], { is2D: true }))).toEqual([0, 1, 2]);
  });
  it("named axes still win (an RSM keeps 2Theta, Omega, Intensity whatever the order)", () => {
    const m = ds(["Omega", "2Theta", "Intensity"], { is2D: true, axis1_name: "Omega" });
    expect(mapDefaults(m)).toEqual([1, 0, 2]);
  });
  it("is null for a non-map and for an ambiguous map", () => {
    expect(mapDefaults(ds(["a", "b", "c"], {}))).toBeNull();
    expect(mapDefaults(ds(["a", "b", "c", "Intensity"], { is2D: true }))).toBeNull();
    expect(mapDefaults(ds(["a", "b"], { is2D: true }))).toBeNull();
  });
});
