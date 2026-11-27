// Wording of the 3-D notes and refusals: singular counts, a categorical colouring with no colour bar,
// and a bar refusal that says why (the gridded map's cells, not the data rows) and what to do.

import { describe, expect, it } from "vitest";

import { extCaption } from "./renderExt3d";
import { hasColorbar, sceneFromBody, type BarScene, type VectorScene } from "./scene3d";

const pts = { contour_source: "points" as const, x_axis: [0, 1, 2, 3], y_axis: [0, 1, 2, 3], z_values: [1, 2, 3, 4] };

describe("a count of one is singular", () => {
  it("vectors: '1 row not drawn'", () => {
    const s = sceneFromBody({ kind: "vectors3d", ...pts, vec_dx: [1, 1, 0, 1], vec_dy: [0, 0, 0, 0], vec_dz: [0, 0, 0, 0] } as never) as VectorScene;
    expect(extCaption(s)).toContain("Drawing 3 vectors");
    expect(extCaption(s)).toContain("1 row not drawn");
    expect(extCaption(s)).not.toContain("1 rows");
  });

  it("vectors: '1 vector'", () => {
    const s = sceneFromBody({ kind: "vectors3d", ...pts, vec_dx: [1, 0, 0, 0], vec_dy: [0, 0, 0, 0], vec_dz: [0, 0, 0, 0] } as never) as VectorScene;
    expect(extCaption(s)).toMatch(/^Drawing 1 vector[ ;,.]/);
  });

  it("bars: '1 row not drawn' when one row is dropped by the colour column", () => {
    const s = sceneFromBody({ kind: "bars3d", ...pts, bar_cval: [1, 2, 3, Number.NaN] } as never) as BarScene;
    const cap = extCaption(s);
    expect(cap).toContain("1 row not drawn");
    expect(cap).not.toContain("1 rows");
  });
});

describe("a categorical colouring has a legend, never a colour bar", () => {
  it("vectors coloured by categories", () => {
    const s = sceneFromBody({ kind: "vectors3d", ...pts, vec_dx: [1, 1, 1, 1], vec_dy: [0, 0, 0, 0], vec_dz: [0, 0, 0, 0], vec_group: [0, 1, 0, 1], vec_group_names: ["a", "b"] } as never) as VectorScene;
    expect(hasColorbar(s)).toBe(false);
  });

  it("bars coloured by categories", () => {
    const s = sceneFromBody({ kind: "bars3d", ...pts, bar_group: [0, 1, 0, 1], bar_group_names: ["a", "b"] } as never) as BarScene;
    expect(hasColorbar(s)).toBe(false);
  });
});

describe("the bar-count refusal says why", () => {
  it("a gridded map: the cells, the grid, and the two ways out", () => {
    const n = 101;
    const axis = Array.from({ length: n }, (_, i) => i);
    const r = sceneFromBody({ kind: "bars3d", x_axis: axis, y_axis: axis, z_grid: axis.map(() => axis.map(() => 1)) } as never);
    if (!("error" in r)) throw new Error("expected a refusal");
    expect(r.error).toContain("the gridded map has 10,201 cells (101 × 101)");
    expect(r.error).toMatch(/Lower the map resolution or crop it/);
    expect(r.error).toContain("Colour by");
    expect(r.error).toContain("10,000");
  });

  it("source rows: no grid wording", () => {
    const n = 10_001;
    const r = sceneFromBody({ kind: "bars3d", contour_source: "points", x_axis: Array.from({ length: n }, (_, i) => i), y_axis: Array.from({ length: n }, (_, i) => i % 7), z_values: Array.from({ length: n }, () => 1) } as never);
    if (!("error" in r)) throw new Error("expected a refusal");
    expect(r.error).toContain("this has 10,001");
    expect(r.error).not.toContain("gridded");
  });
});
