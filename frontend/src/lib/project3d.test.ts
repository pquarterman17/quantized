// The interactive 3-D camera: gesture math, limits, and the box-edge choices.
// Agreement with matplotlib's own projection is pinned separately by the shared
// fixture (Stage/Map3D/map3dViewFixture.test.ts + tests/test_export_map3d_view.py).

import { describe, expect, it } from "vitest";

import { axisEdges, backFaces, boxScale, camera, clampView, keyStep, orbit, project, wrapAzim, zoomBy, ZOOM_RANGE, type View3d } from "./project3d";

const HOME: View3d = { elev: 30, azim: -60, zoom: 1 };
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe("project3d", () => {
  it("wraps azimuth into (-180, 180] and clamps elevation and zoom", () => {
    expect(wrapAzim(190)).toBe(-170);
    expect(wrapAzim(-180)).toBe(180);
    expect(wrapAzim(540)).toBe(180);
    expect(clampView({ elev: 120, azim: 0, zoom: 99 })).toEqual({ elev: 90, azim: 0, zoom: ZOOM_RANGE[1] });
    expect(clampView({ elev: -120, azim: 0, zoom: 0 })).toEqual({ elev: -90, azim: 0, zoom: ZOOM_RANGE[0] });
  });

  it("a drag turns the plot with the pointer: right lowers azimuth, down raises elevation", () => {
    expect(orbit(HOME, 20, 0)).toEqual({ elev: 30, azim: -70, zoom: 1 });
    expect(orbit(HOME, 0, 20)).toEqual({ elev: 40, azim: -60, zoom: 1 });
    expect(orbit(HOME, 0, 1000).elev).toBe(90);
  });

  it("keyboard: arrows rotate 5° (Shift 15°), +/- zoom, other keys are left alone", () => {
    expect(keyStep(HOME, "ArrowLeft", false)?.azim).toBe(-55);
    expect(keyStep(HOME, "ArrowRight", true)?.azim).toBe(-75);
    expect(keyStep(HOME, "ArrowUp", false)?.elev).toBe(35);
    expect(keyStep(HOME, "ArrowDown", true)?.elev).toBe(15);
    expect(keyStep(HOME, "+", false)?.zoom).toBe(1.1);
    expect(keyStep(HOME, "-", false)?.zoom).toBe(0.91);
    expect(keyStep(HOME, "a", false)).toBeNull();
  });

  it("the wheel zooms in on scroll up and out on scroll down, within range", () => {
    expect(zoomBy(HOME, -100).zoom).toBeGreaterThan(1);
    expect(zoomBy(HOME, 100).zoom).toBeLessThan(1);
    expect(zoomBy(HOME, 1e6).zoom).toBe(ZOOM_RANGE[0]);
  });

  it("the camera is orthonormal at any angle, and its scale ignores the angle", () => {
    for (const v of [HOME, { elev: -80, azim: 170, zoom: 2 }, { elev: 90, azim: 0, zoom: 1 }]) {
      const c = camera(v, 600, 400);
      expect(dot(c.right, c.right)).toBeCloseTo(1, 12);
      expect(dot(c.up, c.up)).toBeCloseTo(1, 12);
      expect(dot(c.eye, c.eye)).toBeCloseTo(1, 12);
      expect(dot(c.right, c.up)).toBeCloseTo(0, 12);
      expect(dot(c.right, c.eye)).toBeCloseTo(0, 12);
      expect(dot(c.up, c.eye)).toBeCloseTo(0, 12);
    }
    expect(camera(HOME, 600, 400).scale).toBe(camera({ ...HOME, elev: -10, azim: 100 }, 600, 400).scale);
    expect(camera({ ...HOME, zoom: 2 }, 600, 400).scale).toBe(2 * camera(HOME, 600, 400).scale);
  });

  it("projects the centre to the screen centre; nearer points have larger depth", () => {
    const c = camera(HOME, 600, 400);
    expect(project(c, 0, 0, 0)).toEqual([300, 200, 0]);
    expect(project(c, ...c.eye)[2]).toBeCloseTo(1, 12);
    // Up on screen is DOWN in canvas px.
    expect(project(c, 0, 0, 0.3)[1]).toBeLessThan(200);
  });

  it("maps a data range onto the box side; a flat range sits mid-box", () => {
    const f = boxScale(10, 20, 1);
    expect([f(10), f(15), f(20)]).toEqual([-0.5, 0, 0.5]);
    expect(boxScale(3, 3, 1)(3)).toBe(0);
  });

  it("matplotlib's default view: back panes at x-min, y-max, the floor; ticks front-bottom, z on the right", () => {
    const c = camera(HOME, 600, 400);
    expect(backFaces(c)).toEqual([-1, 1, -1]);
    const e = axisEdges(c);
    expect(e.x).toEqual([-1, -1]); // y = min (front), z = floor
    expect(e.y).toEqual([1, -1]); // x = max (front), z = floor
    // the z edge is the rightmost vertical edge on screen (matplotlib draws it there)
    const sx = (s: readonly [number, number]) => project(c, s[0] / 2, s[1] / 2, 0)[0];
    for (const other of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) expect(sx(e.z)).toBeGreaterThanOrEqual(sx(other));
  });

  it("from below, the axes move to the top edges (the floor is the far face)", () => {
    const c = camera({ elev: -30, azim: -60, zoom: 1 }, 600, 400);
    expect(backFaces(c)[2]).toBe(1);
    expect(axisEdges(c).x[1]).toBe(1);
  });
});
