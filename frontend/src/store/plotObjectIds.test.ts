// BUG-020's class, for plot objects: a reopened project must not get a
// second object with an id it already holds.
//
// Reference lines, annotations, shapes, region shades, map slices and map
// annotations persist with their ids verbatim (lib/plotview.ts's sanitizers,
// lib/mapView.ts's serializer). Their minters used a bare `prefix-N` counter
// that restarts at 0 on every page load, so the first object added after a
// reopen reused `ref-1` / `ann-1` / ... from the saved plot. Every edit and
// delete is keyed by id: one delete removed BOTH objects and one drag moved
// both.
//
// `vi.resetModules()` + a dynamic import gives a fresh module graph, which is
// the only way to observe what a module counter does at startup (the same
// technique as components/Stage/useCutLanding.test.ts).

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Ids a project saved by an earlier session carries — exactly what the old
 *  per-process counters reminted first in the next session. */
const RESTORED = {
  refLines: [{ id: "ref-1", axis: "x" as const, value: 5 }],
  annotations: [{ id: "ann-1", x: 1, y: 2, text: "saved" }],
  shapes: [{ id: "shape-1", kind: "rect" as const, x1: 0, y1: 0, x2: 1, y2: 1 }],
  regionShades: [{ id: "shade-1", x1: 0, x2: 1, y1: 0, y2: 1, fill: "#336699" }],
};

const MAP_DS = "ds-map";

async function reopen() {
  vi.resetModules();
  const { useApp } = await import("./useApp");
  const { DEFAULT_MAP_VIEW } = await import("../lib/mapView");
  useApp.setState({
    ...RESTORED,
    mapViews: {
      [MAP_DS]: {
        ...DEFAULT_MAP_VIEW,
        slices: [{ id: "mslice-1", kind: "h", a: { x: 0, y: 1 }, width: 0, space: "q" }],
        annotations: [{ id: "mann-1", x: 0, y: 0, text: "saved", space: null }],
      },
    },
    history: [],
    future: [],
  });
  return useApp;
}

beforeEach(() => {
  vi.resetModules();
});

describe("plot objects added after a reopen never reuse a restored id", () => {
  it("a new reference line is separately deletable", async () => {
    const useApp = await reopen();
    useApp.getState().addRefLine("y", 7);
    const ids = useApp.getState().refLines.map((r) => r.id);
    expect(new Set(ids).size).toBe(2);
    useApp.getState().removeRefLine(ids[1]);
    expect(useApp.getState().refLines).toEqual(RESTORED.refLines);
  });

  it("a new annotation is separately deletable", async () => {
    const useApp = await reopen();
    const id = useApp.getState().addAnnotation(3, 4, "new");
    expect(id).not.toBe("ann-1");
    useApp.getState().removeAnnotation(id);
    expect(useApp.getState().annotations).toEqual(RESTORED.annotations);
  });

  it("a new shape is separately deletable", async () => {
    const useApp = await reopen();
    const id = useApp.getState().addShape({ kind: "line", x1: 0, y1: 0, x2: 2, y2: 2 });
    expect(id).not.toBe("shape-1");
    useApp.getState().removeShape(id);
    expect(useApp.getState().shapes).toEqual(RESTORED.shapes);
  });

  it("a new region shade is separately deletable", async () => {
    const useApp = await reopen();
    const id = useApp.getState().addRegionShade({ x1: 2, x2: 3, y1: 0, y2: 1, fill: "#993366" });
    expect(id).not.toBe("shade-1");
    useApp.getState().removeRegionShade(id);
    expect(useApp.getState().regionShades).toEqual(RESTORED.regionShades);
  });

  it("a new map slice and map annotation are separately deletable", async () => {
    const useApp = await reopen();
    const sliceId = useApp.getState().addMapSlice(MAP_DS, { kind: "v", a: { x: 2, y: 0 }, width: 0, space: "q" });
    const annId = useApp.getState().addMapAnnotation(MAP_DS, 1, 1, "new", null);
    expect(sliceId).not.toBe("mslice-1");
    expect(annId).not.toBe("mann-1");
    useApp.getState().removeMapSlice(MAP_DS, sliceId!);
    useApp.getState().removeMapAnnotation(MAP_DS, annId!);
    const view = useApp.getState().mapViews[MAP_DS];
    expect(view.slices.map((s) => s.id)).toEqual(["mslice-1"]);
    expect(view.annotations.map((a) => a.id)).toEqual(["mann-1"]);
  });
});
