// The bar / vector options: read clamped, written into the request, and the
// request they make is the one the scene builder and the route accept.

import { describe, expect, it } from "vitest";

import { DEFAULT_MAP3D, sanitizeMap3d, type Map3dView } from "../../lib/mapView3d";
import type { MapPayload } from "../../lib/mapdataFetch";
import { sceneFromBody } from "./Map3D/scene3d";
import { extBody, readExt } from "./map3dExt";
import { mapFigureBody } from "./mapFigureExport";
import { view3dOptions } from "./map3dRequest";

const P: MapPayload = {
  xAxis: [0, 1], yAxis: [0, 1], zGrid: [[0.001, 0.1], [1, 10]],
  xLabel: "x", xUnit: "", yLabel: "y", yUnit: "", zLabel: "z", zUnit: "", zMin: 0.001, zMax: 10,
};
const VIEW = { cmap: "viridis" as const, logZ: false, colorLimits: null, contour: { on: false, levelCount: 0, scale: "linear" as const } };
const body = (v3: Partial<Map3dView>, extra: object = {}) => {
  const full = { ...DEFAULT_MAP3D, ...v3 };
  return mapFigureBody(P, { ...VIEW, view3d: full, ...extra }, view3dOptions(full, "png", "t"));
};

describe("readExt", () => {
  it("defaults, and clamps what a hand-edited file could hold", () => {
    expect(readExt(undefined)).toMatchObject({ barWidth: 0.8, barDepth: 0.8, barColor: null, vec: [null, null, null], vecEnd: false, vecScale: 1, vecHead: 0.2 });
    const o = readExt({ barW: 7, barD: -1, barColor: "red", vecDx: 2.5, vecDy: -1, vecDz: 3, vecHead: 9, vecScale: 0 });
    expect(o).toMatchObject({ barWidth: 1, barDepth: 0.05, barColor: null, vec: [null, null, 3], vecHead: 0.5, vecScale: 1e-6 });
  });
});

describe("sanitizeMap3d keeps the options as plain values", () => {
  it("passes primitives through, drops objects and long keys, and the new kinds are kinds", () => {
    const v = sanitizeMap3d({ kind: "bars3d", ext: { barW: 0.5, barColor: "#112233", nested: { a: 1 }, vecEnd: true, a_very_long_key_name: 1, bad: Infinity } });
    expect(v?.kind).toBe("bars3d");
    expect(v?.ext).toEqual({ barW: 0.5, barColor: "#112233", vecEnd: true });
    expect(sanitizeMap3d({ kind: "vectors3d" })?.ext).toBeUndefined();
    expect(sanitizeMap3d({ kind: "bars3d", ext: 5 })?.ext).toBeUndefined();
  });
});

describe("the request a bar or vector view makes", () => {
  it("bars carry width, depth and a fixed colour only when chosen", () => {
    const b = body({ kind: "bars3d", ext: { barW: 0.5, barColor: "#336699" } });
    expect(b).toMatchObject({ kind: "bars3d", bar_width: 0.5, bar_depth: 0.8, bar_color: "#336699" });
    expect("bar_color" in body({ kind: "bars3d" })).toBe(false);
    expect("error" in sceneFromBody(b)).toBe(false);
  });

  it("a log colour scale sets the base under the lowest bar (z holds log10)", () => {
    const b = mapFigureBody(P, { ...VIEW, logZ: true, view3d: { ...DEFAULT_MAP3D, kind: "bars3d" } }, view3dOptions({ ...DEFAULT_MAP3D, kind: "bars3d" }, "png", "t"));
    expect(b.bar_base).toBe(-3);
    expect(b.colorbar_log10).toBe(true);
  });

  it("vectors send the finite rows of the six picked columns, and say so when none is picked", () => {
    const rows = [[0, 0, 0, 1, 1, 1], [1, 1, 1, 0, 1, 0], [2, 2, 2, NaN, 1, 1]];
    const data = { time: [0, 1, 2], values: rows, labels: ["x", "y", "z", "a", "b", "c"], units: [], metadata: {} };
    const picked = body({ kind: "vectors3d", ext: { vecDx: 3, vecDy: 4, vecDz: 5 } }, { source: { data, keys: [0, 1, 2] } });
    expect(picked).toMatchObject({ contour_source: "points", x_axis: [0, 1], vec_dx: [1, 0], vec_dz: [1, 0], vec_form: "delta" });
    expect("error" in sceneFromBody(picked)).toBe(false);
    // Vectors carry no grid, no log scale and not the map's interpolation note.
    expect(picked).not.toHaveProperty("z_grid");
    expect(picked).not.toHaveProperty("note");
    const logged = mapFigureBody({ ...P, interpolated: { nPoints: 4 } }, { ...VIEW, logZ: true, view3d: { ...DEFAULT_MAP3D, kind: "vectors3d" } }, view3dOptions(DEFAULT_MAP3D, "png", "t"));
    expect(logged).not.toHaveProperty("colorbar_log10");
    expect(logged).not.toHaveProperty("note");
    const none = body({ kind: "vectors3d" }, { source: { data, keys: [0, 1, 2] } });
    expect((sceneFromBody(none) as { error: string }).error).toContain("vec_dx, vec_dy and vec_dz");
    expect(extBody({ ...DEFAULT_MAP3D, kind: "surface" }, {}, undefined, false)).toEqual({});
  });
});
