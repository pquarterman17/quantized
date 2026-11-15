// The map's static 3-D view (gap-5 lane F): its validation, its `.dwk` round
// trip, its undo, and its ride in a saved figure (recipe).

import { beforeEach, describe, expect, it } from "vitest";

import { FIGURE_STYLES } from "../components/workshops/figurebuilder/figureOutputConstants";
import { DEFAULT_MAP3D, MAP3D_STYLES, sanitizeMap3d, type Map3dView } from "./mapView3d";
import { withRecipeMap } from "../store/plotRecipeApply";
import { mapViewFor, sanitizeMapViews } from "./mapView";
import { captureMapView } from "./plotRecipePanels";
import { sanitizeMapView as sanitizeRecipeMapView } from "./plotRecipeMigrate";
import type { Dataset } from "./types";
import { parseWorkspace, serializeWorkspace } from "./workspace";
import { useApp } from "../store/useApp";

const V: Map3dView = { kind: "waterfall", elev: 45, azim: 120, zLabel: "Counts", zUnit: "cps", style: "default", title: "T" };

function ds(id: string): Dataset {
  return { id, name: `${id}.dat`, data: { time: [0, 1], values: [[1, 2, 3], [4, 5, 6]], labels: ["x", "y", "z"], units: ["", "", ""], metadata: {} } };
}

const view3d = () => mapViewFor(useApp.getState().mapViews, "a").view3d;

describe("sanitizeMap3d", () => {
  it("an unknown or missing kind is no 3-D view", () => {
    expect(sanitizeMap3d(undefined)).toBeUndefined();
    expect(sanitizeMap3d({ kind: "volume" })).toBeUndefined();
    expect(sanitizeMap3d("surface")).toBeUndefined();
  });
  it("clamps out-of-range angles, defaults non-numbers, caps text", () => {
    const v = sanitizeMap3d({ kind: "surface", elev: 500, azim: -9e9, zLabel: "z".repeat(500), style: "" })!;
    expect(v.elev).toBe(90);
    expect(v.azim).toBe(-360);
    expect(v.zLabel).toHaveLength(80);
    expect(v.style).toBe(DEFAULT_MAP3D.style);
    expect(sanitizeMap3d({ kind: "scatter3d", elev: "x", azim: NaN })).toMatchObject({ elev: 30, azim: -60 });
  });
  it("an unknown style falls back to the default (the panel could not show it)", () => {
    expect(sanitizeMap3d({ kind: "surface", style: "bogus" })?.style).toBe("default");
    expect(sanitizeMap3d({ kind: "surface", style: "nature" })?.style).toBe("nature");
    expect([...MAP3D_STYLES]).toEqual(FIGURE_STYLES); // the eager copy cannot drift from the figure presets
  });
  it("keeps a valid view unchanged", () => {
    expect(sanitizeMap3d(V)).toEqual(V);
  });
});

describe("the 3-D view is figure state", () => {
  beforeEach(() => {
    useApp.getState().loadWorkspace({ datasets: [ds("a")], activeId: "a" });
  });

  it("is saved in the .dwk and restored into the store", () => {
    useApp.getState().setMapView3d("a", V);
    const text = serializeWorkspace({ datasets: [ds("a")], mapViews: useApp.getState().mapViews });
    const loaded = parseWorkspace(text);
    expect(loaded.mapViews?.a?.view3d).toEqual(V);
    useApp.getState().loadWorkspace({ datasets: [ds("a")] });
    expect(view3d()).toBeUndefined();
    useApp.getState().loadWorkspace(loaded);
    expect(view3d()).toEqual(V);
  });

  it("a stored view with a bad kind or angle is validated on load", () => {
    const m = sanitizeMapViews({ a: { view3d: { kind: "surface", elev: 9999, azim: 0 } }, b: { view3d: { kind: "nope" } } });
    expect(m.a?.view3d?.elev).toBe(90);
    expect(m.b).toBeUndefined(); // no decision recorded -> default entry dropped
  });

  it("is undoable, and an unchanged write records nothing", () => {
    useApp.getState().setMapView3d("a", V);
    const depth = useApp.getState().history.length;
    useApp.getState().setMapView3d("a", { ...V });
    expect(useApp.getState().history.length).toBe(depth);
    useApp.getState().setMapView3d("a", { ...V, elev: 10 });
    expect(view3d()?.elev).toBe(10);
    useApp.getState().undo();
    expect(view3d()).toEqual(V);
    useApp.getState().undo();
    expect(view3d()).toBeUndefined();
  });

  it("returning to 2-D removes the view", () => {
    useApp.getState().setMapView3d("a", V);
    useApp.getState().setMapView3d("a", undefined);
    expect("view3d" in mapViewFor(useApp.getState().mapViews, "a")).toBe(false);
  });

  it("applying a recipe decides the 3-D view: one saved without it returns the target to 2-D", () => {
    const target = { a: { ...mapViewFor({}, "a"), view3d: V } };
    const cleared = withRecipeMap(target, "a", { colormap: "magma", logZ: false, colorLimits: null });
    expect(cleared.a.colormap).toBe("magma");
    expect("view3d" in cleared.a).toBe(false);
    const set = withRecipeMap({}, "a", { colormap: "gray", logZ: false, colorLimits: null, view3d: V });
    expect(set.a.view3d).toEqual(V);
  });

  it("rides in a saved figure (recipe) and is sanitized on read", () => {
    const cap = captureMapView({ ...mapViewFor({}, "a"), view3d: V });
    expect(cap?.view3d).toEqual(V);
    const back = sanitizeRecipeMapView(JSON.parse(JSON.stringify(cap)));
    expect(back?.view3d).toEqual(V);
    expect(sanitizeRecipeMapView({ ...cap, view3d: { kind: "bogus" } })?.view3d).toBeUndefined();
  });
});
