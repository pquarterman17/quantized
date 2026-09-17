// Audit P2.8 — the durable 2-D map view: its writers, its undo coverage, and
// the preservation rule (`bindMapView`) that decides what survives which
// change. The `.dwk`/autosave/Pack-Project half is pinned separately in
// lib/workspaceMapView.test.ts, and the on-screen half (a slice drawn on the
// map surviving a regrid) in components/Stage/MapStage.mapView.test.tsx.

import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_MAP_VIEW } from "../lib/mapView";
import { useApp } from "./useApp";

const H = { kind: "h", a: { x: 32.1, y: 16.05 }, width: 0.2, space: "angular" } as const;
const SEG = {
  kind: "seg",
  a: { x: 30, y: 15 },
  b: { x: 34, y: 17 },
  width: 0,
  space: "angular",
} as const;

describe("map view slice (P2.8)", () => {
  beforeEach(() => {
    useApp.setState({ mapView: DEFAULT_MAP_VIEW, history: [], future: [] });
  });

  it("starts at the documented default — auto limits, linear, viridis, nothing drawn", () => {
    expect(useApp.getState().mapView).toEqual({
      datasetId: null,
      colormap: "viridis",
      logZ: false,
      colorLimits: null,
      slices: [],
      annotations: [],
    });
  });

  it("records slices with their linked positions, and removal is undoable", () => {
    const s = useApp.getState();
    s.bindMapView("ds-1");
    const hId = s.addMapSlice(H);
    const segId = s.addMapSlice(SEG);
    expect(useApp.getState().mapView.slices).toEqual([
      { ...H, id: hId },
      { ...SEG, id: segId },
    ]);

    useApp.getState().removeMapSlice(hId);
    expect(useApp.getState().mapView.slices.map((x) => x.id)).toEqual([segId]);
    useApp.getState().undo();
    expect(useApp.getState().mapView.slices.map((x) => x.id)).toEqual([hId, segId]);
    // The linked position comes back with it, not just the entry.
    expect(useApp.getState().mapView.slices[0]).toEqual({ ...H, id: hId });
  });

  it("removing an unknown slice/annotation id is a no-op — no history entry", () => {
    useApp.getState().removeMapSlice("nope");
    useApp.getState().removeMapAnnotation("nope");
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("annotations carry text at a data coordinate and are undoable", () => {
    const id = useApp.getState().addMapAnnotation(31.5, 16.2, "film peak", "angular");
    expect(useApp.getState().mapView.annotations).toEqual([
      { id, x: 31.5, y: 16.2, text: "film peak", space: "angular" },
    ]);
    useApp.getState().removeMapAnnotation(id);
    expect(useApp.getState().mapView.annotations).toEqual([]);
    useApp.getState().undo();
    expect(useApp.getState().mapView.annotations).toEqual([
      { id, x: 31.5, y: 16.2, text: "film peak", space: "angular" },
    ]);
  });

  it("the colour limits / scale / colormap writers are undoable and leave the slices alone", () => {
    const s = useApp.getState();
    s.bindMapView("ds-1");
    const id = s.addMapSlice(H);

    useApp.getState().setMapColorLimits([10, 5000]);
    useApp.getState().setMapLogZ(true);
    useApp.getState().setMapColormap("magma");
    expect(useApp.getState().mapView).toMatchObject({
      colorLimits: [10, 5000],
      logZ: true,
      colormap: "magma",
    });
    // P2.8 box 1: a colour-limit change must not disturb an existing slice.
    expect(useApp.getState().mapView.slices.map((x) => x.id)).toEqual([id]);

    useApp.getState().undo(); // colormap
    expect(useApp.getState().mapView.colormap).toBe("viridis");
    useApp.getState().undo(); // log scale
    expect(useApp.getState().mapView.logZ).toBe(false);
    useApp.getState().undo(); // colour limits
    expect(useApp.getState().mapView.colorLimits).toBeNull();
    expect(useApp.getState().mapView.slices.map((x) => x.id)).toEqual([id]);
  });

  describe("bindMapView — BUG-012's rule for the map", () => {
    it("re-activating the SAME dataset keeps the limits, slices and annotations", () => {
      const s = useApp.getState();
      s.bindMapView("ds-1");
      s.addMapSlice(H);
      s.addMapAnnotation(31, 16, "peak", "angular");
      useApp.getState().setMapColorLimits([1, 2]);
      const before = useApp.getState().mapView;

      useApp.getState().bindMapView("ds-1");
      // Same object identity, not merely equal: the no-op path must not
      // schedule an autosave or dirty the project on every render.
      expect(useApp.getState().mapView).toBe(before);
    });

    it("a GENUINE dataset switch drops the data-dependent state and keeps the reading preferences", () => {
      const s = useApp.getState();
      s.bindMapView("ds-1");
      s.addMapSlice(H);
      s.addMapAnnotation(31, 16, "peak", "angular");
      useApp.getState().setMapColorLimits([1, 2]);
      useApp.getState().setMapLogZ(true);
      useApp.getState().setMapColormap("magma");

      useApp.getState().bindMapView("ds-2");
      expect(useApp.getState().mapView).toEqual({
        datasetId: "ds-2",
        colormap: "magma", // not data-dependent — the user's reading preference
        logZ: true, // ditto
        colorLimits: null, // in ds-1's z units
        slices: [], // in ds-1's x/y units
        annotations: [], // ditto
      });
    });

    it("binding records no undo entry — it is an activation, not an edit", () => {
      useApp.getState().bindMapView("ds-1");
      useApp.getState().bindMapView("ds-2");
      expect(useApp.getState().history).toHaveLength(0);
    });
  });
});
