import { describe, expect, it } from "vitest";

import { buildFormulaRequest, buildGridRequest, buildLocation, emptyGridForm, gridLabel } from "./mapGridForm";

describe("mapGridForm", () => {
  it("builds the grid request and refuses bad sizes, variance for a non-kriging method, bad Shepard numbers", () => {
    const f = { ...emptyGridForm(), method: "kriging" as const, output: "variance" as const, variogram: "spherical" as const };
    expect(buildGridRequest(f).req).toMatchObject({ method: "kriging", variogram: "spherical", output: "variance", nx: 100, ny: 100, extrapolation: "none" });
    expect(buildGridRequest({ ...emptyGridForm(), nx: "1" }).error).toMatch(/2 to 2000/);
    expect(buildGridRequest({ ...emptyGridForm(), ny: "2.5" }).error).toMatch(/whole/);
    expect(buildGridRequest({ ...emptyGridForm(), output: "variance" }).error).toMatch(/kriging/i);
    const sh = { ...emptyGridForm(), method: "shepard" as const };
    expect(buildGridRequest({ ...sh, shepNeighbors: "2" }).error).toMatch(/neighbours/);
    expect(buildGridRequest({ ...sh, shepRadius: "0" }).error).toMatch(/radius/i);
    expect(buildGridRequest({ ...sh, shepRadius: "" }).req).not.toHaveProperty("shepard_radius");
    expect(gridLabel({ ...emptyGridForm(), logX: true, logY: true })).toBe("grid Natural neighbour logXY");
  });

  it("builds formula and location requests", () => {
    expect(buildFormulaRequest({ expr: "  ", unit: "" }).error).toMatch(/formula/);
    expect(buildFormulaRequest({ expr: " z*2 ", unit: " V " }).req).toEqual({ expr: "z*2", unit: "V" });
    expect(buildLocation({ x: "1.5", y: "" }).error).toMatch(/numbers/);
    expect(buildLocation({ x: "1.5", y: "abc" }).error).toMatch(/numbers/);
    expect(buildLocation({ x: "1.5", y: "-2" }).req).toEqual({ x: 1.5, y: -2 });
  });
});
