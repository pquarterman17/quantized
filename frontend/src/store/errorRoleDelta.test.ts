// vec3d.csv (x, y, z, dx, dy, dz): dx/dy/dz are displacements, so an import
// seeds NO error roles and the plot draws no error bars from them. The
// explicit Inspector "Detect from names" still offers them.
import { beforeEach, describe, expect, it } from "vitest";

import type { DataStruct } from "../lib/types";
import { seedErrorRoles } from "./importErrorRoles";
import { useApp } from "./useApp";

const labels = ["x", "y", "z", "dx", "dy", "dz"];
const vec: DataStruct = {
  time: [0, 1],
  values: [labels.map(() => 1), labels.map(() => 2)],
  labels,
  units: labels.map(() => ""),
  metadata: {},
};

describe("bare dx/dy/dz", () => {
  beforeEach(() => useApp.setState({ datasets: [], plotWindows: [], focusedWindowId: null }));

  it("seed nothing on import", () => {
    expect(seedErrorRoles(vec)).toEqual({});
  });

  it("are still offered by Detect from names", () => {
    useApp.setState({ datasets: [{ id: "v", name: "vec3d.csv", data: vec } as never], activeId: "v" });
    expect(useApp.getState().detectErrorRoles("v")).toBe(2);
    expect(useApp.getState().datasets[0].errorRoles?.map((b) => [b.channel, b.axis])).toEqual([[3, "x"], [4, "y"]]);
  });

  it("an x_err column still seeds as an X error", () => {
    const d = { ...vec, labels: ["y", "x_err"], units: ["", ""], values: [[1, 1], [2, 2]] };
    expect(seedErrorRoles(d).errorRoles).toEqual([{ channel: 1, target: -1, axis: "x", side: "both" }]);
  });
});
