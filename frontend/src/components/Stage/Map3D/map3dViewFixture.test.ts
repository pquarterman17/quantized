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

function fresh() {
  return {
    cases: CASES.map(({ name, steps }) => {
      const view = run(steps);
      const v3 = withCamera({ ...DEFAULT_MAP3D, kind: "surface" }, view);
      const request = mapFigureBody(P, { cmap: "viridis", logZ: false, colorLimits: null, contour: { on: false, levelCount: 0, scale: "linear" }, view3d: v3 }, view3dOptions(v3, "png", "fixture"));
      return { name, view, edges: edges(view), request };
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
