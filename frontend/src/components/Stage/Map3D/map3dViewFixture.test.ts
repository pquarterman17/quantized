// SCREEN == EXPORT for the interactive 3-D view (gap audit 5, item 3e), pinned
// as a SHARED wire fixture (`tests/fixtures/wire/map3d_view.json`).
//
// Each case is a real gesture sequence run through the view's own gesture math
// (`lib/project3d`: orbit / keyStep / zoomBy), the camera the canvas then draws
// with, and the exact `/api/export/map-figure` body ⤓ sends once that view is
// committed (`withCamera` -> `mapFigureBody`). This half asserts the request's
// elev / azim / zoom ARE the view's, and records the screen direction of each
// box edge under the canvas camera. The backend half
// (`tests/test_export_map3d_view.py`) renders each request and checks that
// matplotlib's own projection puts the box edges in the same directions at the
// same zoom -- so the exported figure is the picture on screen, not merely a
// figure carrying the same numbers.
//
// Regenerate only after a DELIBERATE rule change:
//   MAP3D_VIEW_FIXTURE_WRITE=1 npx vitest run src/components/Stage/Map3D/map3dViewFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { MapPayload } from "../../../lib/mapdataFetch";
import { DEFAULT_MAP3D } from "../../../lib/mapView3d";
import { BOX, camera, clampView, keyStep, orbit, zoomBy, type View3d } from "../../../lib/project3d";
import { mapFigureBody } from "../mapFigureExport";
import { view3dOptions } from "../map3dRequest";
import { withCamera } from "./Map3dStageView";
import { frameFor } from "./render3dAxes";
import { sceneFromBody, type Scene3d } from "./scene3d";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "..", "..", "tests", "fixtures", "wire", "map3d_view.json",
);

const HOME: View3d = { elev: DEFAULT_MAP3D.elev, azim: DEFAULT_MAP3D.azim, zoom: DEFAULT_MAP3D.zoom };

const P: MapPayload = {
  xAxis: [0, 1, 2],
  yAxis: [10, 20, 30],
  zGrid: [[1, 2, 3], [2, 4, 6], [3, 6, 9]],
  xLabel: "H", xUnit: "T", yLabel: "T", yUnit: "K", zLabel: "M", zUnit: "emu", zMin: 1, zMax: 9,
};

type Step = { drag: [number, number] } | { key: string; shift?: boolean } | { wheel: number };

const CASES: { name: string; steps: Step[] }[] = [
  { name: "the default view", steps: [] },
  { name: "drag right and down", steps: [{ drag: [120, 40] }] },
  { name: "arrow keys and zoom in", steps: [{ key: "ArrowLeft" }, { key: "ArrowLeft" }, { key: "ArrowUp", shift: true }, { key: "+" }, { key: "+" }] },
  { name: "from below, past 180 degrees, zoomed out", steps: [{ drag: [-500, -150] }, { wheel: 300 }] },
  { name: "looking straight down", steps: [{ drag: [0, 400] }, { wheel: -600 }] },
];

function run(steps: Step[]): View3d {
  let v = HOME;
  for (const s of steps) {
    if ("drag" in s) v = orbit(v, s.drag[0], s.drag[1]);
    else if ("wheel" in s) v = zoomBy(v, s.wheel);
    else v = keyStep(v, s.key, !!s.shift) ?? v;
  }
  return clampView(v); // what the gesture commits
}

/** Screen direction (x right, y UP) of the x, y and z box edges, in units of
 *  the x edge's on-screen length: what matplotlib must reproduce. */
function edges(v: View3d): number[][] {
  const c = camera(v, 600, 400);
  const e = [0, 1, 2].map((i) => [c.right[i] * BOX[i], c.up[i] * BOX[i]]);
  const s = Math.hypot(e[0][0], e[0][1]);
  return e.map(([a, b]) => [a / s, b / s]);
}

/** The box's projected width and height, in units of the axes square's side
 *  (`camera`'s min(w, h)): what the export's box must measure on its figure. */
function extent(v: View3d): number[] {
  const side = 400;
  const c = camera(v, side, side);
  const xs: number[] = [], ys: number[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const p = [sx * BOX[0] / 2, sy * BOX[1] / 2, sz * BOX[2] / 2];
    xs.push(c.right[0] * p[0] + c.right[1] * p[1] + c.right[2] * p[2]);
    ys.push(c.up[0] * p[0] + c.up[1] * p[1] + c.up[2] * p[2]);
  }
  return [xs, ys].map((a) => ((Math.max(...a) - Math.min(...a)) * c.scale) / side);
}

/** Where DATA points land in the box: each point's screen offset from the
 *  box's low corner, in units of the x edge's on-screen length. A padded
 *  matplotlib autoscale (5% margins) moves every one of these. */
const PROBES: [number, number, number][] = [[0, 10, 1], [2, 30, 9], [1, 20, 4], [2, 10, 3]];
function placement(v: View3d, scene: Scene3d): number[][] {
  const f = frameFor(scene, v, 800, 600);
  const at = (b: number[]) => [
    f.cam.right[0] * b[0] + f.cam.right[1] * b[1] + f.cam.right[2] * b[2],
    f.cam.up[0] * b[0] + f.cam.up[1] * b[1] + f.cam.up[2] * b[2],
  ];
  const o = at([-BOX[0] / 2, -BOX[1] / 2, -BOX[2] / 2]);
  const ex = at([BOX[0] / 2, -BOX[1] / 2, -BOX[2] / 2]);
  const len = Math.hypot(ex[0] - o[0], ex[1] - o[1]);
  return PROBES.map(([x, y, z]) => {
    const p = at([f.map[0](x), f.map[1](y), f.map[2](z)]);
    return [(p[0] - o[0]) / len, (p[1] - o[1]) / len];
  });
}

function fresh() {
  return {
    cases: CASES.map(({ name, steps }) => {
      const view = run(steps);
      const v3 = withCamera({ ...DEFAULT_MAP3D, kind: "surface" }, view);
      const request = mapFigureBody(P, { cmap: "viridis", logZ: false, colorLimits: null, contour: { on: false, levelCount: 0, scale: "linear" }, view3d: v3 }, view3dOptions(v3, "png", "fixture"));
      const scene = sceneFromBody(request) as Scene3d;
      return { name, view, edges: edges(view), extent: extent(view), probes: PROBES, placement: placement(view, scene), request };
    }),
  };
}

describe("3-D view, screen == export", () => {
  it.each(fresh().cases)("$name: the export request carries the view's own camera", (c) => {
    expect(c.request).toMatchObject({ view_elev: c.view.elev, view_azim: c.view.azim, view_zoom: c.view.zoom, kind: "surface" });
  });

  it("the gestures move the view (the cases are not all the default)", () => {
    const views = fresh().cases.map((c) => JSON.stringify(c.view));
    expect(new Set(views).size).toBe(views.length);
  });

  it("matches the committed fixture the backend half reads", () => {
    const now = fresh();
    if (process.env.MAP3D_VIEW_FIXTURE_WRITE) writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
  });
});
