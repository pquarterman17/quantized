// The 3-D scatter extras: the panel's edits, the request they make from real
// source columns, the scene the screen builds from it (every refusal the route
// also gives), and the marks painted through `drawScene`.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { DEFAULT_MAP3D, sanitizeMap3d, type Map3dView } from "../../lib/mapView3d";
import type { MapPayload } from "../../lib/mapdataFetch";
import { useApp } from "../../store/useApp";
import { drawScene } from "./Map3D/render3d";
import { frameFor } from "./Map3D/render3dAxes";
import { hasColorbar, sceneFromBody, type PointScene, type Scene3d } from "./Map3D/scene3d";
import Map3dExtFields from "./Map3dExtFields";
import { readScatter } from "./map3dScatter";
import { view3dOptions } from "./map3dRequest";
import { mapFigureBody } from "./mapFigureExport";

const P: MapPayload = {
  xAxis: [0, 1], yAxis: [0, 1], zGrid: [[1, 2], [3, 4]], xLabel: "x", xUnit: "", yLabel: "y", yUnit: "", zLabel: "z", zUnit: "", zMin: 1, zMax: 4,
};
const VIEW = { cmap: "viridis" as const, logZ: false, colorLimits: null, contour: { on: false, levelCount: 0, scale: "linear" as const } };
const rows = [[0, 0, 1, 5, 1, 1], [1, 0, 2, 6, 2, 2], [0, 1, 3, 7, 3, 1], [1, 1, 4, 8, 4, 2], [2, 2, 5, 9, 5, 1]];
const data = { time: rows.map((_, i) => i), values: rows, labels: ["x", "y", "z", "T", "S", "G"], units: [], metadata: {} };
const body = (ext: Map3dView["ext"], logZ = false, vals = rows, metadata: Record<string, unknown> = {}) => {
  const v3: Map3dView = { ...DEFAULT_MAP3D, kind: "scatter3d", ext };
  const src = { data: { ...data, values: vals, time: vals.map((_, i) => i), metadata }, keys: [0, 1, 2] as const };
  return mapFigureBody(P, { ...VIEW, logZ, view3d: v3, source: src }, view3dOptions(v3, "png", "t"));
};
const INK = { text: "#000", dim: "#555", grid: "#ccc", pane: "#eee", border: "#999", ui: "sans-serif", mesh: "#111", drop: "#555" };

describe("the panel", () => {
  function setup(ext?: Map3dView["ext"]) {
    useApp.getState().loadWorkspace({ datasets: [{ id: "d", name: "d.dat", data }], activeId: "d" });
    const edit = vi.fn();
    render(<Map3dExtFields datasetId="d" view3d={{ ...DEFAULT_MAP3D, kind: "scatter3d", ext }} edit={edit} />);
    return edit;
  }

  it("lists the channels, writes a pick, and colour by a column and groups clear each other", () => {
    const edit = setup({ scGroup: 5 });
    const colour = screen.getByLabelText("Colour by") as HTMLSelectElement;
    expect(Array.from(colour.options).map((o) => o.text)).toEqual(["z (height)", "X (first column)", "x", "y", "z", "T", "S", "G"]);
    fireEvent.change(colour, { target: { value: "4" } });
    expect(edit).toHaveBeenLastCalledWith({ ext: { scColor: 4 } });
    fireEvent.change(screen.getByLabelText("Size by"), { target: { value: "5" } });
    expect(edit).toHaveBeenLastCalledWith({ ext: { scGroup: 5, scSize: 5 } });
  });

  it("offers the sheet's text columns to Groups from only, and a pick clears the numeric group and colour", () => {
    useApp.getState().loadWorkspace({ datasets: [{ id: "d", name: "d.dat", data: { ...data, metadata: { text_columns: { metal: ["Fe", "Co", "Fe", "Co", "Fe"] } } } }], activeId: "d" });
    const edit = vi.fn();
    render(<Map3dExtFields datasetId="d" view3d={{ ...DEFAULT_MAP3D, kind: "scatter3d", ext: { scGroup: 5, scColor: 3 } }} edit={edit} />);
    const groups = screen.getByLabelText("Groups from") as HTMLSelectElement;
    expect(Array.from(groups.options).map((o) => o.text)).toContain("metal (text)");
    expect(Array.from((screen.getByLabelText("Colour by") as HTMLSelectElement).options).map((o) => o.text)).not.toContain("metal (text)");
    fireEvent.change(groups, { target: { value: "t:metal" } });
    expect(edit).toHaveBeenLastCalledWith({ ext: { scGroupText: "metal" } });
  });

  it("shows a stored text group as the selection, and a numeric pick drops it", () => {
    useApp.getState().loadWorkspace({ datasets: [{ id: "d", name: "d.dat", data: { ...data, metadata: { text_columns: { metal: ["Fe", "Co", "Fe", "Co", "Fe"] } } } }], activeId: "d" });
    const edit = vi.fn();
    render(<Map3dExtFields datasetId="d" view3d={{ ...DEFAULT_MAP3D, kind: "scatter3d", ext: { scGroupText: "metal" } }} edit={edit} />);
    const groups = screen.getByLabelText("Groups from") as HTMLSelectElement;
    expect(groups.value).toBe("t:metal");
    fireEvent.change(groups, { target: { value: "4" } });
    expect(edit).toHaveBeenLastCalledWith({ ext: { scGroup: 4 } });
  });

  it("each wall is its own checkbox, off by default, and unchecking removes the key", () => {
    const edit = setup({ wallXZ: true });
    expect((screen.getByLabelText("Shadow on the floor (XY)") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText("Shadow on the floor (XY)"));
    expect(edit).toHaveBeenLastCalledWith({ ext: { wallXZ: true, wallXY: true } });
    fireEvent.click(screen.getByLabelText("Shadow on the XZ wall"));
    expect(edit).toHaveBeenLastCalledWith({ ext: undefined });
  });
});

describe("options are read clamped and stored as plain values", () => {
  it("reads picks and flags, ignoring junk", () => {
    expect(readScatter({ scColor: 3, scSize: -1, scGroup: 1.5, wallXY: true, wallXZ: 1 as unknown as boolean })).toMatchObject({ color: 3, size: null, group: null, walls: [true, false, false] });
  });
  it("a text group is stored by its (long) column name and survives the sanitiser", () => {
    const ext = { scGroupText: "sample_material_name" };
    expect(sanitizeMap3d({ kind: "scatter3d", ext })?.ext).toEqual(ext);
    expect(readScatter(ext).groupText).toBe("sample_material_name");
    expect(readScatter({ scGroup: 2, ...ext }).groupText).toBeNull();
  });
  it("the eight-plus keys of a full scatter view survive the sanitiser", () => {
    const ext = { scColor: 3, scSize: 4, scGroup: 5, scErrX: 1, scErrY: 2, scErrZ: 3, wallXY: true, wallXZ: true, wallYZ: true, barW: 0.5, barD: 0.5, barColor: "#112233", vecDx: 1, vecDy: 2, vecDz: 3, vecEnd: true, vecScale: 2, vecHead: 0.3, vecColor: "#112233" };
    expect(sanitizeMap3d({ kind: "scatter3d", ext })?.ext).toEqual(ext);
  });
});

describe("the request", () => {
  it("is the plain scatter with nothing on, and carries only walls when only walls are on", () => {
    expect(Object.keys(body(undefined)).some((k) => k.startsWith("sc_") || k.startsWith("wall_"))).toBe(false);
    const b = body({ wallXZ: true });
    expect(b).toMatchObject({ wall_xz: true });
    expect(b.sc_color).toBeUndefined();
  });

  it("sends the finite source rows with each picked column aligned, and says what it left out", () => {
    const vals = [...rows, [3, 3, NaN, 1, 1, 1], [4, 4, 6, NaN, 1, 1]];
    const b = body({ scColor: 3, scErrZ: 4 }, false, vals);
    expect(b.x_axis).toEqual([0, 1, 0, 1, 2]); // a gap in z and a gap in the colour column are not sent
    expect(b.sc_color).toEqual([5, 6, 7, 8, 9]);
    expect(b.sc_err_z).toEqual([1, 2, 3, 4, 5]);
    expect(b.sc_color_label).toBe("T");
    expect(b.note).toContain("2 rows not drawn");
  });

  it("groups go out as sorted names and an index per row; size says its range in the footnote", () => {
    const b = body({ scGroup: 5, scSize: 4 });
    expect(b.sc_group_names).toEqual(["1", "2"]);
    expect(b.sc_group).toEqual([0, 1, 0, 1, 0]);
    expect(b.note).toContain("Marker size: S, 1 to 5.");
  });

  // Acceptance 5 C11: a text column is the commonest group column.
  it("groups by a text column: sorted names, an index per row, blank cells not drawn", () => {
    const text = ["Fe", "Co", "Fe", "", "Co"]; // row 3 has no group
    const b = body({ scGroupText: "metal" }, false, rows, { text_columns: { metal: text } });
    expect(b.sc_group_names).toEqual(["Co", "Fe"]);
    expect(b.sc_group).toEqual([1, 0, 1, 0]); // rows 0, 1, 2, 4 -- each cell read from its own source row
    expect(b.x_axis).toEqual([0, 1, 0, 2]);
    expect(b.sc_group_label).toBe("metal");
    expect(b.note).toContain("1 row not drawn");
  });

  it("a text group that is not on the sheet (renamed, or gone) groups nothing and draws the plain scatter", () => {
    const b = body({ scGroupText: "metal" }, false, rows, { text_columns: { other: ["a", "b", "c", "d", "e"] } });
    expect(b.sc_group).toBeUndefined();
    expect(b.sc_group_names).toBeUndefined();
  });

  it("a numeric group pick wins over a stored text one", () => {
    const b = body({ scGroup: 5, scGroupText: "metal" }, false, rows, { text_columns: { metal: ["a", "b", "c", "d", "e"] } });
    expect(b.sc_group_names).toEqual(["1", "2"]);
  });

  it("under a log scale z is log10 and a non-positive z is not sent; z error bars are not drawn, and it says so", () => {
    const b = body({ scErrZ: 4, scErrX: 3 }, true, [[0, 0, 100, 1, 1, 1], [1, 1, 0, 1, 1, 1], [2, 2, 10, 2, 2, 1], [3, 3, 1000, 3, 3, 1]]);
    expect(b.z_values).toEqual([2, 1, 3]);
    expect(b.sc_err_z).toBeUndefined();
    expect(b.sc_err_x).toEqual([1, 2, 3]);
    expect(b.note).toContain("Z error bars are not drawn on a log scale");
    expect(b.note).toContain("1 row not drawn");
  });
});

describe("the scene", () => {
  const scene = (b: object) => sceneFromBody(b as never) as PointScene;

  it("colour by a column spans its own range (not the colour limits) and keeps a colour bar", () => {
    const s = scene({ ...body({ scColor: 3 }), z_limits: [0, 100] });
    expect(s.clim).toEqual([5, 9]);
    expect(hasColorbar(s)).toBe(true);
    expect(s.extras?.colorLabel).toBe("T");
  });

  it("groups have no colour bar, and the axes span the error bars", () => {
    const s = scene(body({ scGroup: 5, scErrZ: 4 }));
    expect(hasColorbar(s)).toBe(false);
    expect(s.z.lo).toBeCloseTo(0); // z = 1 minus its error 1
    expect(s.z.hi).toBeCloseTo(10); // z = 5 plus its error 5
  });

  it("size by a column maps 3..10 pt, a flat column the middle", () => {
    expect(Array.from(scene(body({ scSize: 4 })).extras!.diameter!)).toEqual([3, 4.75, 6.5, 8.25, 10]);
    const flat = scene(body({ scSize: 4 }, false, rows.map((r) => [r[0], r[1], r[2], r[3], 7, r[5]])));
    expect(Array.from(flat.extras!.diameter!)).toEqual([6.5, 6.5, 6.5, 6.5, 6.5]);
  });

  it("refuses what the route refuses, with the same reason", () => {
    const b = body({ scColor: 3 });
    expect(sceneFromBody({ ...b, sc_group: [0, 0, 0, 0, 0], sc_group_names: ["a"] })).toEqual({ error: "colour by a column or by groups, not both: send sc_color or sc_group" });
    expect(sceneFromBody({ ...b, sc_color: [1, 2] })).toEqual({ error: "sc_color must have one value per row (5), got 2" });
    const g = body({ scGroup: 5 });
    expect(sceneFromBody({ ...g, sc_group_names: Array.from({ length: 11 }, (_, i) => `${i}`) })).toMatchObject({ error: expect.stringContaining("1 to 10 groups") });
    expect(sceneFromBody({ ...b, sc_size: [NaN, NaN, NaN, NaN, NaN] as never })).toMatchObject({ error: "a 3-D scatter needs at least 3 finite points; found 0" });
    const grid = { ...b, contour_source: "grid", x_axis: [0, 1], y_axis: [0, 1], z_grid: [[1, 2], [3, 4]], z_values: undefined };
    expect(sceneFromBody(grid)).toMatchObject({ error: expect.stringContaining("contour_source='points'") });
  });

  it("more than ten distinct groups is refused on screen with the count, never recoloured", () => {
    const many = Array.from({ length: 12 }, (_, i) => [i, i, i, 1, 1, i]);
    const s = sceneFromBody(body({ scGroup: 5 }, false, many));
    expect(s).toMatchObject({ error: expect.stringContaining("this column has 12") });
  });
});

describe("drawn through drawScene, in the plot's clip", () => {
  beforeAll(async () => vi.stubGlobal("ImageData", (await import("@napi-rs/canvas")).ImageData));
  function painted(b: object, view = { elev: 30, azim: -60, zoom: 1 }) {
    const scene = sceneFromBody(b as never) as Scene3d;
    const f = frameFor(scene, view, 800, 600);
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, p: string) => (p in t ? t[p] : p === "measureText" ? () => ({ width: 10 }) : p === "createLinearGradient" ? () => ({ addColorStop() {} }) : (..._a: unknown[]) => void calls.push(p)),
      set: (t, p: string, v) => ((t[p] = v), true),
    });
    const canvas = Object.assign(document.createElement("canvas"), { width: 800, height: 600 });
    (ctx as Record<string, unknown>).canvas = canvas;
    const stats = drawScene(ctx as unknown as CanvasRenderingContext2D, f, scene, INK, false, 1);
    return { calls, stats, clipAt: calls.indexOf("clip") };
  }

  it("walls, error bars and the legend paint; no legend without groups", () => {
    const g = painted(body({ scGroup: 5, scErrX: 3, wallXY: true }));
    expect(g.clipAt).toBeGreaterThan(-1);
    expect(g.calls.filter((c) => c === "arc")).toHaveLength(5 + 2); // five shadows, two legend swatches
    expect(g.stats.drawn).toBe(5);
    const plain = painted(body({ scColor: 3 }));
    expect(plain.calls.filter((c) => c === "arc")).toHaveLength(0);
  });
});
