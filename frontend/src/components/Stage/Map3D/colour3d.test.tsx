// 3-D vector colour by length, per-bar colour from a column, and end caps on the
// scatter's error bars: the request each option makes from the real
// `mapFigureBody`, the scene built back from it, what the canvas paints, and the
// panel edits. The screen/export agreement is pinned by the shared wire fixtures
// (`plot3dKindsFixture.test.ts`, `plot3dScatterFixture.test.ts`).

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_MAP3D, type Map3dView } from "../../../lib/mapView3d";
import type { MapPayload } from "../../../lib/mapdataFetch";
import { useApp } from "../../../store/useApp";
import { mapFigureBody } from "../mapFigureExport";
import { view3dOptions } from "../map3dRequest";
import Map3dExtFields from "../Map3dExtFields";
import { drawScene } from "./render3d";
import { frameFor } from "./render3dAxes";
import { rgbOf, vectorRgb } from "./renderExt3d";
import { drawScatterBack } from "./renderScatter3d";
import { capSegments } from "./scatterExtras3d";
import { hasColorbar, ownColorbarTitle, sceneFromBody, type BarScene, type PointScene, type VectorScene } from "./scene3d";

const INK = { text: "#000", dim: "#555", grid: "#ccc", pane: "#eee", border: "#999", ui: "sans-serif", mesh: "#111", drop: "#555" };
const P: MapPayload = {
  xAxis: [0, 1, 2], yAxis: [10, 20, 30], zGrid: [[1, 2, 3], [2, 4, 5], [3, 6, 9]],
  xLabel: "H", xUnit: "T", yLabel: "T", yUnit: "K", zLabel: "M", zUnit: "emu", zMin: 1, zMax: 9,
};
const VIEW = { cmap: "viridis" as const, logZ: false, colorLimits: null, contour: { on: false, levelCount: 0, scale: "linear" as const } };
const NaNv = Number.NaN;

const lattice: number[][] = [];
for (const x of [0, 1, 2]) for (const y of [5, 10, 15]) lattice.push([x, y, 1 + x + y / 5]);
const data = (rows: number[][], extra: Record<string, unknown> = {}) => ({
  time: rows.map((_, i) => i), values: rows, labels: ["X", "Y", "Z", "C"], units: ["", "", "", ""], metadata: {}, ...extra,
});

function body(v3: Partial<Map3dView>, rows: number[][], extra: Record<string, unknown> = {}, logZ = false) {
  const view: Map3dView = { ...DEFAULT_MAP3D, ...v3 };
  return mapFigureBody(P, { ...VIEW, logZ, view3d: view, source: { data: data(rows, extra), keys: [0, 1, 2] as const } }, view3dOptions(view, "png", "f"));
}

describe("vectors coloured by length", () => {
  // start, delta
  const arrows = [[0, 0, 0, 3, 4, 0], [1, 0, 0, 0, 0, 2], [2, 1, 0, 1, 2, 2], [0, 2, 1, 0, 0, 0]];
  const make = (ext: Record<string, number | boolean | string>, rows = arrows) => {
    const view: Map3dView = { ...DEFAULT_MAP3D, kind: "vectors3d", ext: { vecDx: 3, vecDy: 4, vecDz: 5, ...ext } };
    const d = { time: rows.map((_, i) => i), values: rows, labels: ["X", "Y", "Z", "dX", "dY", "dZ"], units: [], metadata: {} };
    return mapFigureBody(P, { ...VIEW, view3d: view, source: { data: d, keys: [0, 1, 2] as const } }, view3dOptions(view, "png", "f"));
  };

  it("is off by default and sends no field", () => {
    const b = make({});
    expect(b.vec_by_length).toBeUndefined();
    const s = sceneFromBody(b) as VectorScene;
    expect(s.lengths).toBeNull();
    expect(hasColorbar(s)).toBe(false);
    expect(vectorRgb(s)).toBeNull();
  });

  it("colours by |(dX, dY, dZ)| in data units, whatever the length scale, over the arrows' own extent", () => {
    const s = sceneFromBody(make({ vecLen: true, vecScale: 0.5 })) as VectorScene;
    // 5, 2, 3 by hand (3-4-0, 0-0-2, 1-2-2); the zero-length row is not drawn.
    expect(Array.from(s.lengths!)).toEqual([5, 2, 3]);
    expect(s.hidden).toBe(1);
    expect(s.clim).toEqual([2, 5]);
    expect(hasColorbar(s)).toBe(true);
    expect(ownColorbarTitle(s)).toBe("Vector length");
    // Position 0 and 1 of the range are the colormap's ends; 3 is a third of the way.
    const rgb = vectorRgb(s)!;
    expect(rgb[1]).toBe("rgb(68,1,84)");
    expect(rgb[0]).toBe("rgb(253,231,37)");
    expect(rgb[2]).not.toBe(rgb[1]);
  });

  it("measures end points by end minus start", () => {
    const s = sceneFromBody(make({ vecLen: true, vecEnd: true }, [[1, 1, 1, 4, 5, 1], [0, 0, 0, 0, 0, 3]])) as VectorScene;
    expect(Array.from(s.lengths!)).toEqual([5, 3]);
  });

  it("a flat length range is padded like an axis, and fixed colour plus length is refused", () => {
    const s = sceneFromBody(make({ vecLen: true }, [[0, 0, 0, 1, 0, 0], [1, 1, 1, 0, 1, 0]])) as VectorScene;
    expect(s.clim).toEqual([0.95, 1.05]);
    const both = sceneFromBody(make({ vecLen: true, vecColor: "#112233" }));
    expect(both).toEqual({ error: expect.stringContaining("not both") });
  });

  it("paints one stroke per colour, not one per arrow, and each in its length's colour", () => {
    const s = sceneFromBody(make({ vecLen: true })) as VectorScene;
    const f = frameFor(s, { elev: 30, azim: -60, zoom: 1 }, 800, 600);
    const strokes: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, p: string) => (p in t ? t[p] : p === "measureText" ? () => ({ width: 1 }) : p === "createLinearGradient" ? () => ({ addColorStop() {} }) : p === "stroke" ? () => strokes.push(String(t.strokeStyle)) : () => {}),
      set: (t, p: string, v) => ((t[p] = v), true),
    }) as unknown as CanvasRenderingContext2D;
    drawScene(ctx, f, s, INK, false, 1);
    const colours = new Set(vectorRgb(s));
    for (const c of colours) expect(strokes).toContain(c);
    expect(strokes.filter((c) => c.startsWith("rgb(")).length).toBe(colours.size);
  });
});

describe("bars coloured from a column", () => {
  const rows = lattice.map((r, i) => [...r, i === 3 ? NaNv : (i + 1) * 10]);
  const ext = { barCol: 3 };

  it("is off by default: no column fields, colour by height", () => {
    const b = body({ kind: "bars3d" }, rows);
    expect(b.bar_cval).toBeUndefined();
    expect(b.bar_group).toBeUndefined();
  });

  it("a number column sends the source rows without the gap, a label, a note, and colours over its own extent", () => {
    // The picked index is into the map's column list; the test source is that list, so 3 is "C".
    const plain = body({ kind: "bars3d", ext }, rows);
    expect(plain.bar_cval).toEqual([10, 20, 30, 50, 60, 70, 80, 90]);
    expect(plain.bar_cval_label).toBe("C");
    expect(plain.x_axis).toHaveLength(8);
    expect(plain.note).toContain("1 rows not drawn");
    const s = sceneFromBody(plain) as BarScene;
    expect(s.bx).toHaveLength(8);
    expect(s.clim).toEqual([10, 90]); // not the map's z colour range
    expect(hasColorbar(s)).toBe(true);
    expect(ownColorbarTitle(s)).toBe("C");
    // The lowest and highest column values are the colormap's two ends.
    expect(rgbOf(s, 0)).toEqual([68, 1, 84]);
    expect(rgbOf(s, 7)).toEqual([253, 231, 37]);
  });

  it("a column with a level table is categorical: palette colours and a legend, no colour bar", () => {
    // The level table is keyed by the FILE's channel (2 = "C"); the map's column list has the first column in front.
    const cats = lattice.map((r, i) => [...r, i === 5 ? NaNv : i % 3]);
    const b = body({ kind: "bars3d", ext }, cats, { cat_levels: { 2: ["low", "mid", "high"] } });
    expect(b.bar_group_names).toEqual(["low", "mid", "high"]);
    expect(b.bar_cval).toBeUndefined();
    const s = sceneFromBody(b) as BarScene;
    expect(Array.from(s.colour!.codes!)).toEqual([0, 1, 2, 0, 1, 0, 1, 2]);
    expect(s.colour!.used).toEqual([0, 1, 2]);
    expect(hasColorbar(s)).toBe(false);
    expect(rgbOf(s, 0)).toEqual([31, 119, 180]);
    expect(rgbOf(s, 1)).toEqual([255, 127, 14]);
  });

  it("a text column with more than 10 levels is refused with the count, never recoloured", () => {
    const levels = Array.from({ length: 11 }, (_, i) => `L${i}`);
    const cats = lattice.map((r, i) => [...r, i]);
    const s = sceneFromBody(body({ kind: "bars3d", ext }, cats, { cat_levels: { 2: levels } }));
    expect(s).toEqual({ error: expect.stringMatching(/1 to 10 colour categories; this column has 11/) });
  });

  it("a fixed colour together with a column is refused by the scene, as by the route", () => {
    const s = sceneFromBody(body({ kind: "bars3d", ext: { barCol: 3, barColor: "#112233" } }, rows));
    expect(s).toEqual({ error: expect.stringContaining("not both") });
  });

  it("under a log scale the rows with a non-positive z are left out and the base sits under the lowest bar", () => {
    const logRows = lattice.map((r, i) => [r[0], r[1], i === 0 ? -1 : r[2], i]);
    const b = body({ kind: "bars3d", ext }, logRows, {}, true);
    expect(b.x_axis).toHaveLength(8);
    expect(b.bar_base).toBe(Math.floor(Math.min(...(b.z_values as number[]))));
  });
});

describe("scatter error bar caps", () => {
  const rows = [[0, 5, 1, 0.5], [1, 10, 2, 0.25], [2, 15, 3, NaNv]];
  const scatter = (ext: Record<string, number | boolean>, logZ = false) => body({ kind: "scatter3d", ext }, rows, {}, logZ);

  it("is off by default, and needs a drawn error bar", () => {
    expect(scatter({ scErrX: 3 }).sc_err_caps).toBeUndefined();
    expect(scatter({ scErrCaps: true }).sc_err_caps).toBeUndefined();
    expect(scatter({ scErrZ: 3, scErrCaps: true }, true).sc_err_caps).toBeUndefined();
    expect(scatter({ scErrX: 3, scErrCaps: true }).sc_err_caps).toBe(true);
  });

  it("builds a cross of two segments, 2 x CAP_HALF box units long, at both ends of each drawn bar", () => {
    const s = sceneFromBody(scatter({ scErrX: 3, scErrCaps: true })) as PointScene;
    const e = s.extras!;
    expect(e.caps).toBe(true);
    const caps = capSegments([s.px, s.py, s.pz], e.err, e.hull);
    expect(caps.length / 6).toBe(2 * 2 * 2); // 2 drawn bars (the NaN error draws none) x 2 ends x 2 cross segments
    // The first segment: the low end (x - 0.5) of the first point, along y (the first other axis).
    const span = e.hull[1][1] - e.hull[1][0];
    expect(caps[0]).toBeCloseTo(-0.5, 12);
    expect(caps[3]).toBeCloseTo(-0.5, 12);
    expect(caps[4] - caps[1]).toBeCloseTo(2 * 0.015 * span, 12);
  });

  it("is drawn: the canvas adds the cap segments to the error bar strokes", () => {
    const count = (ext: Record<string, number | boolean>) => {
      const s = sceneFromBody(scatter(ext)) as PointScene;
      const f = frameFor(s, { elev: 30, azim: -60, zoom: 1 }, 800, 600);
      let moves = 0;
      const ctx = new Proxy({} as Record<string, unknown>, {
        get: (t, p: string) => (p in t ? t[p] : p === "moveTo" ? () => { moves++; } : () => {}),
        set: (t, p: string, v) => ((t[p] = v), true),
      }) as unknown as CanvasRenderingContext2D;
      drawScatterBack(ctx, f, s, 1);
      return moves;
    };
    // 2 drawn bars x 2 ends x 2 cross segments.
    expect(count({ scErrX: 3, scErrCaps: true }) - count({ scErrX: 3 })).toBe(8);
  });
});

describe("the panel", () => {
  function setup(v3: Partial<Map3dView>, withLevels = false) {
    useApp.getState().loadWorkspace({
      datasets: [{ id: "d", name: "d.dat", data: { time: [0], values: [[1, 2, 3]], labels: ["A", "B", "C"], units: ["", "", ""], metadata: {}, ...(withLevels ? { cat_levels: { 2: ["u", "v"] } } : {}) } }],
      activeId: "d",
    });
    const edit = vi.fn();
    render(<Map3dExtFields datasetId="d" view3d={{ ...DEFAULT_MAP3D, ...v3 }} edit={edit} />);
    return edit;
  }

  it("bars: picking a column clears the fixed colour; a fixed colour clears the column", () => {
    const edit = setup({ kind: "bars3d", ext: { barColor: "#4c78a8", barW: 0.5 } });
    fireEvent.change(screen.getByLabelText("Bar colour column"), { target: { value: "2" } });
    expect(edit).toHaveBeenLastCalledWith({ ext: { barW: 0.5, barCol: 2 } });
  });

  it("bars: a fixed colour replaces the column pick", () => {
    const edit = setup({ kind: "bars3d", ext: { barCol: 2 } });
    fireEvent.click(screen.getByLabelText("Bar colour: fixed colour"));
    expect(edit).toHaveBeenLastCalledWith({ ext: { barColor: "#4c78a8" } });
    fireEvent.change(screen.getByLabelText("Bar colour column"), { target: { value: "" } });
    expect(edit).toHaveBeenLastCalledWith({ ext: undefined });
  });

  it("vectors: colour by length hides and clears the fixed colour", () => {
    const edit = setup({ kind: "vectors3d", ext: { vecColor: "#2a6fdb", vecScale: 2 } });
    fireEvent.click(screen.getByLabelText("Colour vectors by length"));
    expect(edit).toHaveBeenLastCalledWith({ ext: { vecScale: 2, vecLen: true } });
  });

  it("vectors: with length on there is no fixed colour control, and unchecking turns it off", () => {
    const edit = setup({ kind: "vectors3d", ext: { vecLen: true } });
    expect(screen.queryByLabelText("Vector colour: fixed colour")).toBeNull();
    fireEvent.click(screen.getByLabelText("Colour vectors by length"));
    expect(edit).toHaveBeenLastCalledWith({ ext: undefined });
  });

  it("scatter: the caps checkbox writes scErrCaps", () => {
    const edit = setup({ kind: "scatter3d", ext: { scErrX: 1 } });
    fireEvent.click(screen.getByLabelText("Error bar end caps"));
    expect(edit).toHaveBeenLastCalledWith({ ext: { scErrX: 1, scErrCaps: true } });
  });
});
