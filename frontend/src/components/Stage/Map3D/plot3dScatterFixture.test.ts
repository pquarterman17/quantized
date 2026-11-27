// SCREEN == EXPORT for the 3-D SCATTER extras, pinned as a SHARED wire fixture
// (`tests/fixtures/wire/plot3d_scatter.json`).
//
// Each case is the exact `/api/export/map-figure` body the Map stage sends
// (`mapFigureBody`, from real source columns), the camera, and what the CANVAS
// makes of it: the axes' limits (the hull of points and error bar ends), every
// drawn point, the marker diameters, the colour range, the groups and their
// palette colours, the error bars, the wall each shadow lands on and the
// projected 2-D position of known points. `tests/test_export_plot3d_scatter.py`
// renders each request and matplotlib's OWN artists must agree.
//
// Regenerate only after a DELIBERATE rule change:
//   PLOT3D_FIXTURE_WRITE=1 npx vitest run src/components/Stage/Map3D/plot3dScatterFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { MapPayload } from "../../../lib/mapdataFetch";
import { DEFAULT_MAP3D, type Map3dView } from "../../../lib/mapView3d";
import { BOX } from "../../../lib/project3d";
import { mapFigureBody } from "../mapFigureExport";
import { view3dOptions } from "../map3dRequest";
import { frameFor } from "./render3dAxes";
import { GROUP_COLORS, wallValues } from "./scatterExtras3d";
import { sceneFromBody, type PointScene } from "./scene3d";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "tests", "fixtures", "wire", "plot3d_scatter.json");

const P: MapPayload = {
  xAxis: [0, 1, 2], yAxis: [10, 20, 30], zGrid: [[1, 2, 3], [2, 4, 5], [3, 6, 9]],
  xLabel: "H", xUnit: "T", yLabel: "T", yUnit: "K", zLabel: "M", zUnit: "emu", zMin: 1, zMax: 9,
};
const VIEW = { cmap: "viridis" as const, logZ: false, colorLimits: null, contour: { on: false, levelCount: 0, scale: "linear" as const } };
const NaNv = Number.NaN;
// X, Y, Z, colour, size, group, ex, ey, ez
const rows: number[][] = [
  [0, 5, 1, 10, 2, 1, 0.1, 0.5, 0.2], [1, 5, 3, 20, 4, 2, 0.2, 0.5, 0.3], [2, 5, 2, 30, 6, 1, 0.1, 0.5, 0.2],
  [0, 15, 4, 15, 8, 3, 0.3, 0.5, 0.4], [1, 15, 6, 25, 3, 2, 0.1, 0.5, 0.2], [2, 15, 5, 35, 5, 3, 0.2, NaNv, -1],
  [3, 25, 7, 12, 7, 1, 0.2, 0.5, 0.1], [1, 25, NaNv, 22, 1, 2, 0.1, 0.5, 0.2], // a gap in z: not drawn
];
const data = { time: rows.map((_, i) => i), values: rows, labels: ["X", "Y", "Z", "Temp", "Mass", "Field", "dX", "dY", "dZ"], units: [], metadata: {} };

interface Case { name: string; v3: Partial<Map3dView>; source: boolean }
const CASES: Case[] = [
  { name: "colour by a column, sized, z errors, floor shadow", source: true, v3: { kind: "scatter3d", elev: 30, azim: -60, zoom: 1, ext: { scColor: 3, scSize: 4, scErrZ: 8, wallXY: true } } },
  { name: "three groups, x and y errors, side walls", source: true, v3: { kind: "scatter3d", elev: -25, azim: 130, zoom: 1.2, ext: { scGroup: 5, scErrX: 6, scErrY: 7, wallXZ: true, wallYZ: true } } },
  { name: "walls only, on a gridded scatter", source: false, v3: { kind: "scatter3d", elev: 40, azim: 200, zoom: 1, ext: { wallXY: true, wallXZ: true, wallYZ: true } } },
];

function build(c: Case) {
  const v3: Map3dView = { ...DEFAULT_MAP3D, ...c.v3 };
  const body = mapFigureBody(P, { ...VIEW, view3d: v3, ...(c.source ? { source: { data, keys: [0, 1, 2] as const } } : {}) }, view3dOptions(v3, "png", "fixture"));
  return { v3, body, scene: sceneFromBody(body) as PointScene };
}

function fresh() {
  return CASES.map((c) => {
    const { v3, body, scene } = build(c);
    const f = frameFor(scene, v3, 800, 600);
    const at = (b: number[]) => [
      f.cam.right[0] * b[0] + f.cam.right[1] * b[1] + f.cam.right[2] * b[2],
      f.cam.up[0] * b[0] + f.cam.up[1] * b[1] + f.cam.up[2] * b[2],
    ];
    const o = at([-BOX[0] / 2, -BOX[1] / 2, -BOX[2] / 2]);
    const ex = at([BOX[0] / 2, -BOX[1] / 2, -BOX[2] / 2]);
    const len = Math.hypot(ex[0] - o[0], ex[1] - o[1]);
    const place = (p: number[]) => {
      const q = at([f.map[0](p[0]), f.map[1](p[1]), f.map[2](p[2])]);
      return [(q[0] - o[0]) / len, (q[1] - o[1]) / len];
    };
    const e = scene.extras;
    const pts = Array.from(scene.px, (_, i) => [scene.px[i], scene.py[i], scene.pz[i]]);
    const probes = [pts[0], pts[Math.floor(pts.length / 2)], pts[pts.length - 1]];
    // The wall each shadow lands on, by the canvas's own eye test and by `wallValues`.
    const wall = [scene.x, scene.y, scene.z].map((a, k) => (f.cam.eye[k] > 0 ? a.lo : a.hi));
    return {
      name: c.name, view: { elev: v3.elev, azim: v3.azim, zoom: v3.zoom }, request: body,
      limits: [scene.x, scene.y, scene.z].map((a) => [a.lo, a.hi]),
      points: pts, probes, placement: probes.map(place),
      clim: scene.clim, colorbar: !!(e?.color || !e?.codes), colorLabel: e?.colorLabel ?? "",
      diameter: e?.diameter ? Array.from(e.diameter) : null,
      groups: e?.codes ? { names: e.names, used: e.used, label: e.groupLabel, colors: Array.from(e.codes, (g) => GROUP_COLORS[g]) } : null,
      errors: (e?.err ?? []).map((a) => (a ? Array.from(a) : null)),
      err_skipped: e?.errSkipped ?? 0,
      walls: e?.walls ?? [false, false, false], wall_at: wall,
      wall_values: e ? wallValues(e.hull, v3.elev, v3.azim) : null,
      note: scene.extras?.note ?? "",
    };
  });
}

describe("3-D scatter extras, screen == export", () => {
  const cases = fresh();

  it("every case builds a scene (the fixture holds no refusals)", () => {
    for (const c of CASES) expect("error" in build(c).scene).toBe(false);
  });

  it("the rows that cannot draw are left out, and the notes say so", () => {
    expect(cases[0].points).toHaveLength(7);
    expect(cases[0].note).toContain("1 rows not drawn");
    expect(cases[0].note).toContain("Marker size: Mass, 2 to 8")
    expect(cases[0].err_skipped).toBe(1); // the negative z error;
    expect(cases[1].err_skipped).toBe(1); // the NaN y error
    expect(cases[1].groups).toMatchObject({ names: ["1", "2", "3"], used: [0, 1, 2], label: "Field" });
    expect(cases[2].diameter).toBeNull();
    expect(cases[2].walls).toEqual([true, true, true]);
  });

  it("the canvas's wall rule is wallValues' rule", () => {
    for (const c of cases) if (c.wall_values) expect(c.wall_at).toEqual(c.wall_values);
  });

  it("colour by a column makes a colour bar over its own range; groups make none", () => {
    expect(cases[0].colorbar).toBe(true);
    expect(cases[0].clim).toEqual([10, 35]);
    expect(cases[1].colorbar).toBe(false);
  });

  it("matches the committed fixture the backend half reads", () => {
    if (process.env.PLOT3D_FIXTURE_WRITE) writeFileSync(FIXTURE, `${JSON.stringify({ cases }, null, 2)}\n`, "utf8");
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify({ cases })));
  });
});
