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

    it("a removal that drops NO entry keeps the record's identity (round 3, finding 12)", () => {
      useApp.getState().loadWorkspace({ datasets: [ds("ds-a"), ds("ds-b")] });
      useApp.getState().addMapSlice("ds-a", H);
      const before = useApp.getState().mapViews;

      useApp.getState().removeDataset("ds-b"); // ds-b has no view
      expect(useApp.getState().mapViews).toBe(before);
    });
  });

  // -- Trash restore (review round 3, finding 1) ---------------------------
  //
  // The pruning above is right, but `removeDatasets` is ALSO the send-to-Trash
  // path, and Trash ▸ Restore puts the dataset back under the SAME id. Before
  // this round the entry that would have matched it was simply gone: Undo of
  // the delete restored the view (it rides `HistorySnapshot`), Restore did not
  // — silently, and with no way back. The view now travels ON the trash entry.
  describe("Trash restore keeps the map view (round 3, finding 1)", () => {
    beforeEach(() => {
      useApp.getState().loadWorkspace({ datasets: [ds("ds-a"), ds("ds-b")], activeId: "ds-a" });
      useApp.setState({ mapViews: EMPTY_MAP_VIEWS, trash: [], history: [], future: [] });
    });

    it("limits + a slice survive delete → Restore, entry-identical", async () => {
      useApp.getState().setMapColorLimits("ds-a", [3, 9]);
      useApp.getState().setMapLogZ("ds-a", true);
      useApp.getState().addMapSlice("ds-a", H);
      const captured = view("ds-a");
      expect(captured.slices).toHaveLength(1);

      useApp.getState().removeDataset("ds-a");
      expect(useApp.getState().mapViews["ds-a"]).toBeUndefined();
      expect(useApp.getState().trash).toHaveLength(1);

      const r = await useApp.getState().restoreFromTrash("dataset:ds-a");
      expect(r).toEqual({ ok: true });
      expect(useApp.getState().datasets.map((d) => d.id)).toContain("ds-a");
      expect(view("ds-a")).toEqual(captured);
      expect(view("ds-a").slices[0]).toEqual(captured.slices[0]);
      // ds-b was never involved either way.
      expect(view("ds-b")).toBe(DEFAULT_MAP_VIEW);
    });

    it("a dataset with no view costs the entry nothing and restores nothing", async () => {
      useApp.getState().removeDataset("ds-a");
      const entry = useApp.getState().trash[0];
      expect(entry.kind === "dataset" && entry.mapView).toBeUndefined();

      await useApp.getState().restoreFromTrash("dataset:ds-a");
      expect(useApp.getState().mapViews["ds-a"]).toBeUndefined();
    });

    it("a view that came back some other way WINS — restore never overwrites it", async () => {
      useApp.getState().setMapColorLimits("ds-a", [3, 9]);
      useApp.getState().removeDataset("ds-a");
      // The id is live in `mapViews` again (an undo, a re-import) while the
      // dataset still sits in the trash.
      useApp.setState({ mapViews: { "ds-a": { ...DEFAULT_MAP_VIEW, colorLimits: [100, 200] } } });

      await useApp.getState().restoreFromTrash("dataset:ds-a");
      expect(view("ds-a").colorLimits).toEqual([100, 200]);
    });
  });

  // -- History labels (review round 3, finding 9) --------------------------
  describe("history labels name the dataset (round 3, finding 9)", () => {
    it("every writer's label carries the dataset name", () => {
      useApp.getState().loadWorkspace({ datasets: [ds("ds-a"), ds("ds-b")] });
      useApp.setState({ mapViews: EMPTY_MAP_VIEWS, history: [], future: [] });

      useApp.getState().setMapColormap("ds-a", "magma");
      useApp.getState().setMapLogZ("ds-b", true);
      useApp.getState().addMapSlice("ds-b", H);
      expect(useApp.getState().history.map((h) => h.label)).toEqual([
        'change map colormap "ds-a.xrdml"',
        'change map colour scale "ds-b.xrdml"',
        'add map slice "ds-b.xrdml"',
      ]);
    });

    it("a dataset the store does not have keeps the bare label", () => {
      useApp.getState().setMapColormap("ds-gone", "magma");
      expect(useApp.getState().history.map((h) => h.label)).toEqual(["change map colormap"]);
    });
  });

  // -- The transient painted-limits channel (round 3, finding 2) -----------
  describe("reportMapPaintedLimits (round 3, finding 2)", () => {
    it("records per dataset and ignores a repeat of the same pair", () => {
      useApp.getState().reportMapPaintedLimits("ds-a", [7, 9]);
      const first = useApp.getState().mapPaintedLimits;
      expect(first["ds-a"]).toEqual([7, 9]);

      useApp.getState().reportMapPaintedLimits("ds-a", [7, 9]); // same pair, fresh array
      expect(useApp.getState().mapPaintedLimits).toBe(first);

      useApp.getState().reportMapPaintedLimits("ds-b", null);
      expect(useApp.getState().mapPaintedLimits["ds-b"]).toBeNull();
      expect(useApp.getState().mapPaintedLimits["ds-a"]).toEqual([7, 9]);
    });

    it("records no history and never becomes a map VIEW edit", () => {
      useApp.setState({ history: [] });
      useApp.getState().reportMapPaintedLimits("ds-a", [7, 9]);
      expect(useApp.getState().history).toEqual([]);
      expect(useApp.getState().mapViews["ds-a"]).toBeUndefined();
    });
  });
});
