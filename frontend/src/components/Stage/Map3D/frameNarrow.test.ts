// OG17: a narrow 3-D window kept a fixed 120 x 90 px margin, so the scene was about a quarter of its pane.
import { describe, expect, it } from "vitest";

import type { MapFigureSpec } from "../../../lib/api/mapFigure";
import { frameFor } from "./render3dAxes";
import { sceneFromBody } from "./scene3d";

const GRID: MapFigureSpec = {
  x_axis: [0, 1, 2], y_axis: [10, 20, 30], z_grid: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
  kind: "surface", cmap: "viridis", x_label: "x", y_label: "y", z_label: "z",
};
const V = { elev: 30, azim: -60, zoom: 1 };

describe("frameFor margins", () => {
  const scene = sceneFromBody(GRID);
  if ("error" in scene) throw new Error(scene.error);

  it("a narrow pane gives the box more of its width than the old fixed margin did", () => {
    const narrow = frameFor(scene, V, 430, 1000);
    // plot width 334 (430 - 96 colour bar); camera width 334 - 66.8, was 334 - 120.
    const wide = frameFor(scene, V, 1400, 1000);
    // The old margin would have given scale proportional to (334 - 120) / (1304 - 120) = 0.18.
    expect(narrow.cam.scale / wide.cam.scale).toBeGreaterThan(0.2);
  });

  it("is unchanged from 600 x 450 up (the margins cap at 120 x 90)", () => {
    const f = frameFor(scene, V, 800, 600);
    const g = frameFor(scene, V, 1600, 1200);
    // Same box, margins 120 x 90 in both: scale is set by the smaller fit side.
    expect(f.plot.w).toBe(704);
    expect(g.cam.scale).toBeGreaterThan(f.cam.scale);
  });
});
