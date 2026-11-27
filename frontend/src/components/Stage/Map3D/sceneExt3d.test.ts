// The bar and vector scenes: the footprint, the base, the arrowhead, the caps and
// every refusal (each mirrors `calc/figure_map3d_ext.py`; the shared fixture
// test pins the two numerically).

import { describe, expect, it } from "vitest";

import { frameFor } from "./render3dAxes";
import { barFaces, extCaption } from "./renderExt3d";
import { sceneFromBody, type BarScene, type Scene3d, type VectorScene } from "./scene3d";
import { MAX_BARS, MAX_VECTORS, medianStep, vectorSegments } from "./sceneExt3d";

const GRID = { kind: "bars3d", x_axis: [0, 1, 2, 3], y_axis: [10, 20, 30], z_grid: [[1, 2, 3, 4], [2, 4, 6, null], [3, 6, 9, 1]] };
const PTS = { kind: "vectors3d", contour_source: "points", x_axis: [0, 1, 2], y_axis: [0, 1, 0], z_values: [0, 1, 2] };
const scene = (b: object) => sceneFromBody(b as never);
const err = (b: object) => (scene(b) as { error: string }).error;

describe("bar scene", () => {
  it("builds one bar per finite cell, sized as a fraction of the median step, based at 0", () => {
    const s = scene({ ...GRID, bar_width: 0.5 }) as BarScene;
    expect(s.kind).toBe("bars");
    expect(s.bx.length).toBe(11); // 12 cells, one gap
    expect(s.dx).toBeCloseTo(0.5);
    expect(s.dy).toBeCloseTo(8); // default depth 0.8 of a 10 step
    expect(s.base).toBe(0);
    expect(s.z.lo).toBe(0);
    expect([s.x.lo, s.x.hi]).toEqual([-0.25, 3.25]);
    // The colour range is the bars' heights, not the base.
    expect(s.clim).toEqual([1, 9]);
    expect(s.fixed).toBeNull();
  });

  it("a negative bar hangs from the base and the z axis spans both", () => {
    const s = scene({ ...GRID, z_grid: [[-2, 2], [1, 3]], x_axis: [0, 1], y_axis: [0, 1] }) as BarScene;
    expect([s.z.lo, s.z.hi]).toEqual([-2, 3]);
  });

  it("a fixed colour has no colour bar; colouring by height has one", () => {
    const f = (b: object) => frameFor(scene(b) as Scene3d, { elev: 30, azim: -60, zoom: 1 }, 800, 600);
    expect(f({ ...GRID, bar_color: "#336699" }).bar).toBeNull();
    expect(f(GRID).bar).not.toBeNull();
  });

  it("paints only the faces that look at the viewer, far to near", () => {
    const s = scene({ ...GRID }) as BarScene;
    const f = frameFor(s, { elev: 30, azim: -60, zoom: 1 }, 800, 600);
    const faces = barFaces(f, s);
    expect(faces.length).toBe(11 * 3); // top and two sides of each box
    const depths = faces.map((q) => q.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    // From below, the bottom replaces the top.
    const below = barFaces(frameFor(s, { elev: -30, azim: -60, zoom: 1 }, 800, 600), s);
    expect(below.length).toBe(11 * 3);
    expect(extCaption(s)).toBe("Drawing 11 bars.");
  });

  it.each([
    [{ ...GRID, bar_width: 0 }, "bar_width must be"],
    [{ ...GRID, bar_depth: 1.2 }, "bar_depth must be"],
    [{ ...GRID, bar_color: "red" }, "#rrggbb"],
    [{ ...GRID, bar_base: Infinity }, "bar_base"],
    [{ ...GRID, z_grid: [[null, null, null, null], [null, null, null, null], [null, null, null, null]] }, "at least 1 finite bar"],
    [{ ...GRID, z_grid: [[1, 2]] }, "z_grid must be"],
    [{ kind: "bars3d", contour_source: "points", x_axis: [1, 1], y_axis: [0, 1], z_values: [1, 2] }, "2 distinct x positions"],
  ])("refuses %# with a reason", (b, msg) => {
    expect(err(b)).toContain(msg);
  });

  it("refuses more than the cap instead of sampling", () => {
    const n = MAX_BARS + 1;
    const xs = Array.from({ length: n }, (_, i) => i);
    expect(err({ kind: "bars3d", contour_source: "points", x_axis: xs, y_axis: xs, z_values: xs })).toContain("at most 10,000 bars");
  });
});

describe("medianStep", () => {
  it("is the median of the positive steps between distinct sorted values", () => {
    expect(medianStep([0, 1, 2, 4, 4])).toBe(1);
    expect(medianStep([3])).toBe(0);
    expect(medianStep([0, 1, 3])).toBe(1.5);
  });
});

describe("vector scene", () => {
  const ok = { ...PTS, vec_dx: [1, 0, 1], vec_dy: [0, 1, 1], vec_dz: [1, 1, 0] };

  it("tail plus delta, five segments an arrow, axes spanning tails and tips", () => {
    const s = scene(ok) as VectorScene;
    expect(s.kind).toBe("vectors");
    expect(Array.from(s.tips.slice(0, 3))).toEqual([1, 0, 1]);
    expect(s.segs.length).toBe(3 * 30);
    expect([s.x.lo, s.x.hi]).toEqual([0, 3]);
    expect(extCaption(s)).toBe("Drawing 3 vectors.");
  });

  it("an end-point form with a scale, and rows with no length are counted, not drawn", () => {
    const s = scene({ ...PTS, vec_form: "end", vec_scale: 2, vec_dx: [2, 1, 4], vec_dy: [0, 1, 1], vec_dz: [0, 1, 2] }) as VectorScene;
    // row 1 (tail 1,1,1) ends where it starts: no length.
    expect(s.hidden).toBe(1);
    expect(Array.from(s.tips.slice(0, 3))).toEqual([4, 0, 0]);
    expect(extCaption(s)).toContain("1 rows not drawn");
  });

  it("every barb starts at the tip and the head is built in box space", () => {
    const s = scene(ok) as VectorScene;
    const lim: [number, number][] = [[s.x.lo, s.x.hi], [s.y.lo, s.y.hi], [s.z.lo, s.z.hi]];
    const g = vectorSegments(s.tails, s.tips, lim, 0.2);
    for (let j = 1; j < 5; j++) expect(Array.from(g.slice(6 * j, 6 * j + 3))).toEqual(Array.from(s.tips.slice(0, 3)));
    expect(Array.from(g)).toEqual(Array.from(s.segs));
  });

  it.each([
    [{ ...PTS }, "vec_dx, vec_dy and vec_dz"],
    [{ ...ok, contour_source: "grid" }, "contour_source='points'"],
    [{ ...ok, vec_dx: [1] }, "one value per row"],
    [{ ...ok, vec_scale: 0 }, "vec_scale"],
    [{ ...ok, vec_head: 0.9 }, "vec_head"],
    [{ ...ok, vec_color: "blue" }, "#rrggbb"],
    [{ ...ok, vec_dx: [0, 0, 0], vec_dy: [0, 0, 0], vec_dz: [0, 0, 0] }, "non-zero length"],
  ])("refuses %# with a reason", (b, msg) => {
    expect(err(b)).toContain(msg);
  });

  it("refuses more than the cap", () => {
    const n = MAX_VECTORS + 1;
    const a = Array.from({ length: n }, (_, i) => i);
    const ones = a.map(() => 1);
    expect(err({ kind: "vectors3d", contour_source: "points", x_axis: a, y_axis: a, z_values: a, vec_dx: ones, vec_dy: ones, vec_dz: ones })).toContain("at most 20,000");
  });
});
