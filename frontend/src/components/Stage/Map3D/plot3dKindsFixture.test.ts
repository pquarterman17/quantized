// SCREEN == EXPORT for the 3-D BAR and VECTOR kinds, pinned as a SHARED wire
// fixture (`tests/fixtures/wire/plot3d_kinds.json`).
//
// Each case is the exact `/api/export/map-figure` body the Map stage sends for
// the kind (`mapFigureBody`, from a real payload + source columns), the camera,
// and what the CANVAS makes of it: the axes' limits, the bars' boxes, the first
// arrow's five segments, the projected 2-D position of a few known data points
// under that camera (in units of the box's x-edge length, from the low corner)
// and the depth order (far to near) of the marks. The backend half
// (`tests/test_export_plot3d_kinds.py`) renders each request and checks that
// matplotlib's own artists and projection agree on every one.
//
// Regenerate only after a DELIBERATE rule change:
//   PLOT3D_FIXTURE_WRITE=1 npx vitest run src/components/Stage/Map3D/plot3dKindsFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { MapPayload } from "../../../lib/mapdataFetch";
import { DEFAULT_MAP3D, type Map3dView } from "../../../lib/mapView3d";
import { BOX } from "../../../lib/project3d";
import { mapFigureBody } from "../mapFigureExport";
import { view3dOptions } from "../map3dRequest";
import { barBox, rgbOf, vectorRgb } from "./renderExt3d";
import { frameFor } from "./render3dAxes";
import { hasColorbar, ownColorbarTitle, sceneFromBody, type BarScene, type Scene3d, type VectorScene } from "./scene3d";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "..", "..", "tests", "fixtures", "wire", "plot3d_kinds.json",
);

const P: MapPayload = {
  xAxis: [0, 1, 2], yAxis: [10, 20, 30], zGrid: [[1, 2, 3], [2, 4, null], [3, 6, 9]],
  xLabel: "H", xUnit: "T", yLabel: "T", yUnit: "K", zLabel: "M", zUnit: "emu", zMin: 1, zMax: 9,
  interpolated: { nPoints: 8 },
};
const VIEW = { cmap: "viridis" as const, logZ: false, colorLimits: null, contour: { on: false, levelCount: 0, scale: "linear" as const } };

const lattice: number[][] = [];
for (const x of [0, 1, 2, 3]) for (const y of [5, 10, 15]) lattice.push([x, y, 1 + x * 2 + (y % 7), 0, 0, 0]);
const arrows: number[][] = [
  [0, 0, 0, 1, 2, 3], [1, 0, 0, 0, 0, 2], [2, 1, 0.5, -1, 1, 0], [0, 2, 1, 0.5, 0.5, 0.5],
  [3, 3, 1, 0, 0, 0], // zero length: not drawn
  [1, 1, Number.NaN, 1, 1, 1], // a gap: not drawn
];
// Bars coloured by column 3: a number column with a gap, and a categorical one (its level table is keyed by the
// FILE's channel, one less than the map column: `mapColumns` puts the first column in front).
const valued = lattice.map((r, i) => [r[0], r[1], r[2], i === 4 ? Number.NaN : 2 + i * 1.5, 0, 0]);
const sorted = lattice.map((r, i) => [r[0], r[1], r[2], i === 7 ? Number.NaN : i % 3, 0, 0]);
// A TEXT column of the sheet (`metadata.text_columns`, by name): one cell per source row, a blank cell leaves the bar out.
const metals = lattice.map((_, i) => (i === 2 ? "" : ["Ni", "Fe", "Co", "Cu"][(i * 5) % 4]));
const data = (rows: number[][], catLevels?: Record<number, string[]>, text?: Record<string, string[]>) => ({
  time: rows.map((_, i) => i), values: rows, labels: ["X", "Y", "Z", "dX", "dY", "dZ"], units: ["", "", "", "", "", ""], metadata: text ? { text_columns: text } : {},
  ...(catLevels ? { cat_levels: catLevels } : {}),
});
const KEYS = [0, 1, 2] as const;

interface Case { name: string; v3: Partial<Map3dView>; rows: number[][]; levels?: Record<number, string[]>; text?: Record<string, string[]> }
const CASES: Case[] = [
  { name: "bars from a grid", v3: { kind: "bars3d", elev: 30, azim: -60, zoom: 1 }, rows: [] },
  { name: "bars from XYZ columns, fixed colour", v3: { kind: "bars3d", elev: 50, azim: 40, zoom: 1.5, ext: { barW: 0.5, barD: 0.6, barColor: "#336699" } }, rows: lattice },
  { name: "vectors from deltas", v3: { kind: "vectors3d", elev: -20, azim: 100, zoom: 1, ext: { vecDx: 3, vecDy: 4, vecDz: 5, vecHead: 0.25 } }, rows: arrows },
  { name: "vectors to end points, scaled", v3: { kind: "vectors3d", elev: 35, azim: -130, zoom: 1, ext: { vecDx: 3, vecDy: 4, vecDz: 5, vecEnd: true, vecScale: 0.5, vecHead: 0.3, vecColor: "#aa3311" } }, rows: arrows },
  { name: "bars coloured by a number column", v3: { kind: "bars3d", elev: 35, azim: 25, zoom: 1, ext: { barW: 0.7, barD: 0.7, barCol: 3 } }, rows: valued },
  { name: "bars coloured by a category", v3: { kind: "bars3d", elev: 45, azim: -120, zoom: 1, ext: { barCol: 3 } }, rows: sorted, levels: { 2: ["low", "mid", "high"] } },
  { name: "vectors coloured by length", v3: { kind: "vectors3d", elev: 20, azim: -45, zoom: 1, ext: { vecDx: 3, vecDy: 4, vecDz: 5, vecLen: true, vecScale: 0.8 } }, rows: arrows },
  { name: "bars coloured by a text column", v3: { kind: "bars3d", elev: 40, azim: 70, zoom: 1.2, ext: { barW: 0.6, barD: 0.9, barColText: "metal" } }, rows: lattice, text: { metal: metals } },
];

function build(c: Case) {
  const v3: Map3dView = { ...DEFAULT_MAP3D, ...c.v3 };
  const source = c.rows.length ? { data: data(c.rows, c.levels, c.text), keys: KEYS } : undefined;
  const body = mapFigureBody(P, { ...VIEW, view3d: v3, ...(source ? { source } : {}) }, view3dOptions(v3, "png", "fixture"));
  return { v3, body, scene: sceneFromBody(body) as Scene3d };
}

const mid = (s: BarScene, i: number): number[] => {
  const b = barBox(s, i);
  return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2];
};

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
    const depth = (p: number[]) => [f.map[0](p[0]), f.map[1](p[1]), f.map[2](p[2])].reduce((a, v, k) => a + v * f.cam.eye[k], 0);
    const far = (pts: number[][]) => pts.map((p, i) => [depth(p), i]).sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    const out: Record<string, unknown> = {
      name: c.name, view: { elev: v3.elev, azim: v3.azim, zoom: v3.zoom }, request: body,
      limits: [scene.x, scene.y, scene.z].map((a) => [a.lo, a.hi]),
    };
    if (scene.kind === "bars") {
      const idx = Array.from(scene.bx, (_, i) => i);
      const probes = [0, Math.floor(idx.length / 2), idx.length - 1].map((i) => [scene.bx[i], scene.by[i], scene.bz[i]]);
      Object.assign(out, {
        bars: idx.map((i) => { const b = barBox(scene, i); return [b.x0, b.x1, b.y0, b.y1, b.z0, b.z1]; }),
        probes, placement: probes.map(place), depth_order: far(idx.map((i) => mid(scene, i))),
      });
      if (scene.colour) {
        const c = scene.colour;
        Object.assign(out, {
          colour: {
            kind: c.codes ? "categories" : "values", values: c.values ? Array.from(c.values) : null, codes: c.codes ? Array.from(c.codes) : null,
            names: c.names, used: c.used, colorLabel: c.colorLabel, groupLabel: c.groupLabel, dropped: c.dropped,
            clim: scene.clim, colorbar: hasColorbar(scene), title: ownColorbarTitle(scene), rgb: idx.map((i) => rgbOf(scene, i)),
          },
        });
      }
    } else {
      const s = scene as VectorScene;
      const n = s.tails.length / 3;
      const tail = (i: number) => [s.tails[3 * i], s.tails[3 * i + 1], s.tails[3 * i + 2]];
      const tip = (i: number) => [s.tips[3 * i], s.tips[3 * i + 1], s.tips[3 * i + 2]];
      const barb = [s.segs[9], s.segs[10], s.segs[11]];
      const probes = [tail(0), tip(0), tip(n - 1), barb];
      Object.assign(out, {
        segments: Array.from({ length: 5 }, (_, j) => [Array.from(s.segs.slice(6 * j, 6 * j + 3)), Array.from(s.segs.slice(6 * j + 3, 6 * j + 6))]),
        drawn: n, hidden: s.hidden, probes, placement: probes.map(place), depth_order: far(Array.from({ length: n }, (_, i) => tip(i))),
      });
      if (s.lengths) {
        const css = vectorRgb(s) as string[];
        Object.assign(out, {
          colour: {
            lengths: Array.from(s.lengths), clim: s.clim, colorbar: hasColorbar(s), title: ownColorbarTitle(s),
            rgb: css.map((c) => (c.match(/\d+/g) as string[]).map(Number)),
          },
        });
      }
    }
    return out;
  });
}

describe("3-D bars and vectors, screen == export", () => {
  const cases = fresh();

  it("every case builds a scene (the fixture holds no refusals)", () => {
    for (const c of CASES) expect("error" in build(c).scene).toBe(false);
  });

  it("the cases differ in view and kind, and the vector rows that cannot draw are counted", () => {
    expect(new Set(cases.map((c) => JSON.stringify(c.view))).size).toBe(CASES.length);
    expect(cases.filter((c) => "hidden" in c).map((c) => c.hidden)).toEqual([1, 0, 1]);
    // deltas: the zero-length row is hidden; end points: that row is a real arrow. A row with
    // a gap never leaves the client (the body holds finite rows only).
    expect(cases[0].request).toMatchObject({ kind: "bars3d", z_grid: expect.any(Array) });
    expect(cases[1].request).toMatchObject({ kind: "bars3d", contour_source: "points", bar_color: "#336699", bar_width: 0.5 });
    expect(cases[3].request).toMatchObject({ kind: "vectors3d", vec_form: "end", vec_scale: 0.5, vec_color: "#aa3311" });
  });

  it("a text column colours the bars by its sorted names; the blank cell's row is left out and counted", () => {
    const c = cases[7] as { request: Record<string, unknown[]>; colour: { kind: string; used: number[]; groupLabel: string; dropped: number; colorbar: boolean } };
    expect(c.request.bar_group_names).toEqual(["Co", "Cu", "Fe", "Ni"]);
    // By hand: row i holds Ni, Fe, Co, Cu in turn (row 2, a Co, is blank); Co=0, Cu=1, Fe=2, Ni=3.
    expect(c.request.bar_group).toEqual([3, 2, 1, 3, 2, 0, 1, 3, 2, 0, 1]);
    expect(c.request.bar_group_label).toBe("metal");
    expect(c.request.bar_cval).toBeUndefined();
    expect(c.colour).toMatchObject({ kind: "categories", groupLabel: "metal", colorbar: false });
  });

  it("matches the committed fixture the backend half reads", () => {
    if (process.env.PLOT3D_FIXTURE_WRITE) writeFileSync(FIXTURE, `${JSON.stringify({ cases }, null, 2)}\n`, "utf8");
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify({ cases })));
  });
});
