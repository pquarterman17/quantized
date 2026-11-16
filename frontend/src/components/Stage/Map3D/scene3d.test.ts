// The interactive 3-D scene is built from the export's own request, under the
// same rules `calc/figure_map.py` draws it with.

import { describe, expect, it } from "vitest";

import type { MapFigureSpec } from "../../../lib/api/mapFigure";
import { MAP3D_MAX_POINTS } from "../map3dRequest";
import { frameFor } from "./render3dAxes";
import { FAST_CELLS, FAST_POINTS, pick, pickSet, pointStride, surfaceQuads } from "./render3dMarks";
import { sceneFromBody, type LineScene, type PointScene, type SurfaceScene } from "./scene3d";

const GRID: MapFigureSpec = {
  x_axis: [0, 1, 2], y_axis: [10, 20, 30],
  z_grid: [[null, 2, 3], [4, 5, 6], [7, 8, 9]],
  kind: "surface", cmap: "RdBu_r", x_label: "H (T)", y_label: "T (K)", z_label: "M (emu)",
};

describe("sceneFromBody", () => {
  it("a surface keeps gaps as NaN and spans the drawn data", () => {
    const s = sceneFromBody(GRID) as SurfaceScene;
    expect(s.kind).toBe("surface");
    expect(Number.isNaN(s.zs[0])).toBe(true);
    expect([s.x.lo, s.x.hi, s.y.lo, s.y.hi, s.z.lo, s.z.hi]).toEqual([0, 2, 10, 30, 2, 9]);
    expect(s.clim).toEqual([2, 9]);
    expect(s.cmap).toBe("rdbu"); // matplotlib's RdBu_r is the canvas' rdbu
    expect([s.x.label, s.y.label, s.z.label]).toEqual(["H (T)", "T (K)", "M (emu)"]);
  });

  it("explicit colour limits are the colour range; the z axis still spans the data", () => {
    const s = sceneFromBody({ ...GRID, z_limits: [0, 20], colorbar_log10: true }) as SurfaceScene;
    expect(s.clim).toEqual([0, 20]);
    expect([s.z.lo, s.z.hi]).toEqual([2, 9]);
    expect(s.log10).toBe(true);
  });

  it("a grid scatter is its finite cells in row order (as the route meshgrids them)", () => {
    const s = sceneFromBody({ ...GRID, kind: "scatter3d", drop_lines: true }) as PointScene;
    expect(Array.from(s.pz)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(Array.from(s.py)).toEqual([10, 10, 20, 20, 20, 30, 30, 30]);
    expect(s.drop).toBe(true);
  });

  it("a big grid scatter is sampled to the route's cap", () => {
    const n = 300;
    const big: MapFigureSpec = { kind: "scatter3d", x_axis: Array.from({ length: n }, (_, i) => i), y_axis: Array.from({ length: n }, (_, i) => i), z_grid: Array.from({ length: n }, (_, j) => Array.from({ length: n }, (_, i) => i + j)) };
    expect((sceneFromBody(big) as PointScene).px.length).toBe(MAP3D_MAX_POINTS);
  });

  it("raw points go through unchanged", () => {
    const s = sceneFromBody({ contour_source: "points", kind: "scatter3d", x_axis: [0, 1, 2, NaN], y_axis: [0, 1, 0, 1], z_values: [5, 6, 7, 8] }) as PointScene;
    expect(Array.from(s.pz)).toEqual([5, 6, 7]);
  });

  it("a grid waterfall: rows with 2+ points, evenly stepped to max_lines, coloured by row position", () => {
    const rows: (number | null)[][] = Array.from({ length: 10 }, (_, j) => [j, j + 1, j + 2]);
    rows[3] = [null, 1, null];
    const s = sceneFromBody({ kind: "waterfall", x_axis: [0, 1, 2], y_axis: rows.map((_, j) => j), z_grid: rows, max_lines: 4 }) as LineScene;
    expect(s.lines.map((l) => l.y[0])).toEqual([0, 4, 6, 9]); // rows with data 0,1,2,4..9; round(linspace(0, 8, 4)) = 0,3,5,8
    expect(s.lines.map((l) => l.t)).toEqual([0, 4 / 9, 6 / 9, 1]);
  });

  it("separate curves sit at their depths, coloured by order", () => {
    const s = sceneFromBody({ contour_source: "curves", kind: "waterfall", curves: [{ x: [0, 1], z: [1, 2], depth: 10 }, { x: [0, 1, 2], z: [3, NaN, 4], depth: 20 }] }) as LineScene;
    expect(s.lines.map((l) => [l.y[0], l.t, l.x.length])).toEqual([[10, 0, 2], [20, 1, 2]]);
  });

  it("refuses what the route refuses, with its reason", () => {
    expect(sceneFromBody({ ...GRID, z_grid: [[1, null, null], [null, null, null], [null, null, 2]] })).toEqual({ error: "a 3-D surface needs at least 4 finite grid cells; found 2" });
    expect(sceneFromBody({ ...GRID, z_grid: [[1, null, 2], [null, 3, null], [4, null, 5]] })).toEqual({ error: "a 3-D surface needs at least one grid cell with four finite corners" });
    expect(sceneFromBody({ ...GRID, kind: "waterfall", z_grid: [[1, 2, 3], [null, 1, null], [null, null, null]] })).toMatchObject({ error: expect.stringMatching(/at least 2 curves/) });
  });
});

describe("painting", () => {
  const big: MapFigureSpec = {
    kind: "surface", x_axis: Array.from({ length: 200 }, (_, i) => i), y_axis: Array.from({ length: 200 }, (_, i) => i),
    z_grid: Array.from({ length: 200 }, (_, j) => Array.from({ length: 200 }, (_, i) => Math.sin(i / 20) * Math.cos(j / 30))),
  };
  const view = { elev: 30, azim: -60, zoom: 1 };

  it("surface quads are painted far to near (painter's algorithm)", () => {
    const s = sceneFromBody(big) as SurfaceScene;
    const q = surfaceQuads(frameFor(s, view, 800, 600), s, false);
    const d = Array.from(q.order, (i) => q.depth[i]);
    expect(d.every((v, i) => i === 0 || v >= d[i - 1])).toBe(true);
    expect(q.order.length).toBe(199 * 199);
  });

  it("while moving, a 200x200 surface is drawn on a strided grid and a 1e5 cloud is thinned; settled, in full", () => {
    const s = sceneFromBody(big) as SurfaceScene;
    const fast = surfaceQuads(frameFor(s, view, 800, 600), s, true);
    expect(fast.mx).toBeLessThanOrEqual(FAST_CELLS + 1);
    expect(fast.order.length).toBeLessThanOrEqual(FAST_CELLS * FAST_CELLS);
    expect(Math.ceil(1e5 / pointStride(1e5, true))).toBeLessThanOrEqual(FAST_POINTS);
    expect(pointStride(1e5, false)).toBe(1);
  });

  it("hover picks the vertex under the pointer at the FRONT, not one hidden behind it", () => {
    const f32 = (...v: number[]) => Float32Array.from(v);
    const f64 = (...v: number[]) => Float64Array.from(v);
    // vertex 0 is exactly under the pointer but far; vertex 1 is 4 px off but in front
    const set = { sx: f32(100, 104, 300), sy: f32(100, 100, 300), depth: f32(-0.4, 0.3, 0.9), x: f64(1, 2, 3), y: f64(1, 2, 3), z: f64(1, 2, 3) };
    expect(pick(set, 100, 100)).toBe(1);
    expect(pick(set, 300, 302)).toBe(2);
    expect(pick(set, 200, 200)).toBeNull();
  });

  it("the pick set holds every drawn vertex at its projected position", () => {
    const s = sceneFromBody(GRID) as SurfaceScene;
    const f = frameFor(s, view, 800, 600);
    const set = pickSet(f, s);
    expect(set.x.length).toBe(8); // 9 cells, one gap
    expect(pick(set, set.sx[0], set.sy[0])).not.toBeNull();
  });
});
