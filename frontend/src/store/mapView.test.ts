// Audit P2.8 — the durable 2-D map view: its writers, its undo coverage, and
// the per-dataset keying (review round 2) that decides what a second open map
// can and cannot reach. The `.dwk`/autosave/Pack-Project half is pinned
// separately in lib/workspaceMapView.test.ts, and the on-screen half (a slice
// drawn on the map surviving a regrid) in
// components/Stage/MapStage.mapView.test.tsx.

import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_MAP_VIEW, EMPTY_MAP_VIEWS, mapViewFor } from "../lib/mapView";
import { useApp } from "./useApp";
import type { Dataset } from "../lib/types";

const H = { kind: "h", a: { x: 32.1, y: 16.05 }, width: 0.2, space: "angular" } as const;
const SEG = {
  kind: "seg",
  a: { x: 30, y: 15 },
  b: { x: 34, y: 17 },
  width: 0,
  space: "angular",
} as const;

const view = (id: string) => mapViewFor(useApp.getState().mapViews, id);

function ds(id: string): Dataset {
  return {
    id,
    name: `${id}.xrdml`,
    data: {
      time: [0, 1],
      values: [
        [1, 2],
        [3, 4],
      ],
      labels: ["A", "B"],
      units: ["", ""],
      metadata: {},
    },
  };
}

describe("map view slice (P2.8)", () => {
  beforeEach(() => {
    useApp.setState({ mapViews: EMPTY_MAP_VIEWS, history: [], future: [] });
  });

  it("starts empty — no dataset has a view, and every lookup is the default", () => {
    expect(useApp.getState().mapViews).toEqual({});
    expect(view("ds-1")).toBe(DEFAULT_MAP_VIEW);
    expect(DEFAULT_MAP_VIEW).toEqual({
      colormap: "viridis",
      logZ: false,
      colorLimits: null,
      slices: [],
      annotations: [],
    });
  });

  it("records slices with their linked positions, and removal is undoable", () => {
    const s = useApp.getState();
    const hId = s.addMapSlice("ds-1", H);
    const segId = s.addMapSlice("ds-1", SEG);
    expect(view("ds-1").slices).toEqual([
      { ...H, id: hId },
      { ...SEG, id: segId },
    ]);

    useApp.getState().removeMapSlice("ds-1", hId!);
    expect(view("ds-1").slices.map((x) => x.id)).toEqual([segId]);
    useApp.getState().undo();
    expect(view("ds-1").slices.map((x) => x.id)).toEqual([hId, segId]);
    // The linked position comes back with it, not just the entry.
    expect(view("ds-1").slices[0]).toEqual({ ...H, id: hId });
  });

  // Review round 2, finding 7: every "undoable" claim the first cut made was
  // about REMOVAL. With no pin here, deleting `recordHistory` from `addMapSlice`
  // left the whole suite green — and a Ctrl+Z after taking a cut would then
  // silently undo the user's PREVIOUS, unrelated action.
  it("ADDING a slice is undoable — and redo brings it back", () => {
    const id = useApp.getState().addMapSlice("ds-1", H);
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["add map slice"]);
    useApp.getState().undo();
    expect(view("ds-1").slices).toEqual([]);
    useApp.getState().redo();
    expect(view("ds-1").slices.map((x) => x.id)).toEqual([id]);
  });

  it("ADDING an annotation is undoable", () => {
    useApp.getState().addMapAnnotation("ds-1", 31.5, 16.2, "film peak", "angular");
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["add map annotation"]);
    useApp.getState().undo();
    expect(view("ds-1").annotations).toEqual([]);
  });

  it("removing an unknown slice/annotation id is a no-op — no history entry", () => {
    useApp.getState().removeMapSlice("ds-1", "nope");
    useApp.getState().removeMapAnnotation("ds-1", "nope");
    expect(useApp.getState().history).toHaveLength(0);
    expect(useApp.getState().mapViews).toEqual({});
  });

  it("a writer with no dataset to write to does nothing at all", () => {
    expect(useApp.getState().addMapSlice(null, H)).toBeNull();
    expect(useApp.getState().addMapAnnotation(null, 1, 2, "x", null)).toBeNull();
    useApp.getState().setMapColormap(null, "magma");
    expect(useApp.getState().mapViews).toEqual({});
    expect(useApp.getState().history).toHaveLength(0);
  });

  // Review round 2, finding 15: `removeMapSlice`/`removeMapAnnotation` already
  // guarded their no-op; the three view writers did not, so re-picking the
  // value already showing consumed an undo step, changed the field identity,
  // and made `shouldAutosave` true.
  it("re-writing the SAME value records nothing — no history, same identity", () => {
    useApp.getState().setMapColorLimits("ds-1", [10, 50]);
    const after = useApp.getState().mapViews;
    expect(useApp.getState().history).toHaveLength(1);

    useApp.getState().setMapColorLimits("ds-1", [10, 50]);
    useApp.getState().setMapColormap("ds-1", "viridis");
    useApp.getState().setMapLogZ("ds-1", false);
    expect(useApp.getState().mapViews).toBe(after);
    expect(useApp.getState().history).toHaveLength(1);
  });

  it("the colour limits / scale / colormap writers are undoable and leave the slices alone", () => {
    const id = useApp.getState().addMapSlice("ds-1", H);

    useApp.getState().setMapColorLimits("ds-1", [10, 5000]);
    useApp.getState().setMapLogZ("ds-1", true);
    useApp.getState().setMapColormap("ds-1", "magma");
    expect(view("ds-1")).toMatchObject({
      colorLimits: [10, 5000],
      logZ: true,
      colormap: "magma",
    });
    // P2.8 box 1: a colour-limit change must not disturb an existing slice.
    expect(view("ds-1").slices.map((x) => x.id)).toEqual([id]);

    useApp.getState().undo(); // colormap
    expect(view("ds-1").colormap).toBe("viridis");
    useApp.getState().undo(); // log scale
    expect(view("ds-1").logZ).toBe(false);
    useApp.getState().undo(); // colour limits
    expect(view("ds-1").colorLimits).toBeNull();
    expect(view("ds-1").slices.map((x) => x.id)).toEqual([id]);
  });

  describe("one view per dataset (review round 2, finding 1)", () => {
    it("a second dataset's view is independent — neither can destroy the other", () => {
      const a = useApp.getState().addMapSlice("ds-a", H);
      useApp.getState().setMapColorLimits("ds-a", [1, 2]);
      const b = useApp.getState().addMapSlice("ds-b", SEG);
      useApp.getState().setMapColorLimits("ds-b", [7, 8]);

      expect(view("ds-a").slices.map((x) => x.id)).toEqual([a]);
      expect(view("ds-a").colorLimits).toEqual([1, 2]);
      expect(view("ds-b").slices.map((x) => x.id)).toEqual([b]);
      expect(view("ds-b").colorLimits).toEqual([7, 8]);
    });

    it("editing one dataset's view leaves the other's object IDENTITY untouched", () => {
      useApp.getState().addMapSlice("ds-a", H);
      const a = view("ds-a");
      useApp.getState().addMapSlice("ds-b", SEG);
      expect(view("ds-a")).toBe(a);
    });

    it("a dataset REMOVAL drops that dataset's entry and keeps the others", () => {
      useApp.getState().loadWorkspace({ datasets: [ds("ds-a"), ds("ds-b")] });
      useApp.getState().addMapSlice("ds-a", H);
      useApp.getState().addMapSlice("ds-b", SEG);

      useApp.getState().removeDataset("ds-a");
      expect(Object.keys(useApp.getState().mapViews)).toEqual(["ds-b"]);
      expect(view("ds-a")).toBe(DEFAULT_MAP_VIEW);
    });
  });
});
