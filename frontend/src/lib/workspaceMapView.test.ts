// Audit P2.8 — "Persist color limits/scale/map/slices/annotations".
//
// Drives the REAL `.dwk` pair (`serializeWorkspace`/`parseWorkspace`) and the
// real store restore (`loadWorkspace`), not a hand-rolled stand-in, plus the
// two other writers that share them: autosave's change trigger
// (`shouldAutosave`) and Pack Project's whole-state spread. The byte-
// compatibility pin follows BUG-017's: an ordinary document — one whose map
// view was never touched — must serialize byte-for-byte as it did before the
// field existed.

import { describe, expect, it } from "vitest";

import { EMPTY_MAP_VIEWS, type MapViewMap, type MapViewState } from "./mapView";
import type { Dataset } from "./types";
import { parseWorkspace, serializeWorkspace } from "./workspace";
import { shouldAutosave, type AutosaveState } from "../useWorkspaceAutosave";
import { serializeCurrentWorkspaceForPack } from "../store/packProjectContent";
import { useApp } from "../store/useApp";

function makeDataset(id: string, name: string): Dataset {
  return {
    id,
    name,
    data: {
      time: [0, 1, 2],
      values: [
        [10, 100],
        [20, 200],
        [30, 300],
      ],
      labels: ["A", "B"],
      units: ["emu", "Oe"],
      metadata: { source: "test" },
    },
  };
}

/** A fully-populated map view: every one of the five things P2.8's box names
 *  (colour limits, colour scale, colormap, slices, annotations). */
const VIEW_A: MapViewState = {
  colormap: "magma",
  logZ: true,
  colorLimits: [12.5, 9000],
  slices: [
    { id: "mslice-1", kind: "h", a: { x: 32.1, y: 16.05 }, width: 0.2, space: "angular" },
    { id: "mslice-2", kind: "v", a: { x: 31.4, y: 15.7 }, width: 0, space: "angular" },
    {
      id: "mslice-3",
      kind: "seg",
      a: { x: 30, y: 15 },
      b: { x: 34, y: 17 },
      width: 0.05,
      space: "q",
    },
  ],
  annotations: [{ id: "mann-1", x: 31.5, y: 16.2, text: "film peak", space: "angular" }],
};

const VIEW_B: MapViewState = {
  colormap: "gray",
  logZ: false,
  colorLimits: [0, 5],
  slices: [{ id: "mslice-9", kind: "h", a: { x: 1, y: 2 }, width: 0, space: "q" }],
  annotations: [],
};

const FULL: MapViewMap = { a: VIEW_A, b: VIEW_B };

const docOf = (ws: Parameters<typeof serializeWorkspace>[0]): Record<string, unknown> =>
  JSON.parse(serializeWorkspace(ws)) as Record<string, unknown>;

describe("map view `.dwk` persistence (P2.8)", () => {
  it("round-trips EVERY dataset's colour limits, scale, colormap, slice positions and annotations", () => {
    const loaded = parseWorkspace(
      serializeWorkspace({
        datasets: [makeDataset("a", "rsm"), makeDataset("b", "other")],
        mapViews: FULL,
      }),
    );
    expect(loaded.mapViews).toEqual(FULL);
  });

  it("a saved view reaches the STORE on reopen, not just the parse result", () => {
    const text = serializeWorkspace({
      datasets: [makeDataset("a", "rsm"), makeDataset("b", "other")],
      mapViews: FULL,
    });
    useApp.setState({ mapViews: EMPTY_MAP_VIEWS });
    useApp.getState().loadWorkspace(parseWorkspace(text));
    expect(useApp.getState().mapViews).toEqual(FULL);
  });

  it("opening a project whose doc has no map view CLEARS the previous project's ones", () => {
    // The cross-project leak `loadWorkspace`'s own `workbooks` comment warns
    // about: a stale colour limit and slice positions are in another map's
    // units, so they must not survive an Open.
    useApp
      .getState()
      .loadWorkspace(
        parseWorkspace(
          serializeWorkspace({
            datasets: [makeDataset("a", "rsm"), makeDataset("b", "other")],
            mapViews: FULL,
          }),
        ),
      );
    expect(useApp.getState().mapViews.a?.slices).toHaveLength(3);

    useApp
      .getState()
      .loadWorkspace(parseWorkspace(serializeWorkspace({ datasets: [makeDataset("b", "other")] })));
    expect(useApp.getState().mapViews).toEqual({});
  });

  // Round 4, finding 2: `mapPaintedLimits` is transient paint state, not part
  // of the `.dwk` document, so it is never mentioned by `mapViews`'s own
  // round-2 test above — but it is keyed by the SAME dataset ids, and a
  // reopened project (or a sibling saved from it) can bring the SAME id back
  // live, with the PREVIOUS project's painted pair still attached. Cleared
  // for the same reason `mapViews` is, right beside it in `loadWorkspace`.
  it("loadWorkspace also clears the previous project's PAINTED-limits report", () => {
    useApp.getState().reportMapPaintedLimits("a", [7, 9]);
    useApp.getState().loadWorkspace({ datasets: [makeDataset("a", "rsm")] });
    expect(useApp.getState().mapPaintedLimits).toEqual({});
  });

  it("a pre-P2.8 doc (no field at all) loads as the empty record", () => {
    const loaded = parseWorkspace(serializeWorkspace({ datasets: [makeDataset("a", "rsm")] }));
    expect(loaded.mapViews).toEqual({});
  });

  // The FIRST P2.8 commit (c1757fb1, unmerged but on this branch) wrote ONE
  // object carrying its own `datasetId`. A `.dwk` written by that build must
  // still open with its slices on the right map.
  it("MIGRATION: the first cut's single `mapView` object becomes that dataset's entry", () => {
    const doc = docOf({ datasets: [makeDataset("a", "rsm")] });
    doc.mapView = { datasetId: "a", ...VIEW_A };
    const loaded = parseWorkspace(JSON.stringify(doc));
    expect(loaded.mapViews).toEqual({ a: VIEW_A });
  });

  it("MIGRATION: a first-cut view bound to no dataset, or to a missing one, is dropped", () => {
    const doc = docOf({ datasets: [makeDataset("a", "rsm")] });
    doc.mapView = { datasetId: null, ...VIEW_A };
    expect(parseWorkspace(JSON.stringify(doc)).mapViews).toEqual({});
    doc.mapView = { datasetId: "gone", ...VIEW_A };
    expect(parseWorkspace(JSON.stringify(doc)).mapViews).toEqual({});
  });

  it("BYTE-COMPATIBILITY: an untouched map view writes no field at all", () => {
    const datasets = [makeDataset("a", "rsm")];
    const without = serializeWorkspace({ datasets });
    // Round-2 shape of "untouched": the record may carry an all-default ENTRY
    // (a map was opened and nothing was decided) and must still write nothing.
    const untouched = serializeWorkspace({
      datasets,
      mapViews: { a: { colormap: "viridis", logZ: false, colorLimits: null, slices: [], annotations: [] } },
    });
    // `savedAt` is a fresh timestamp on every call — normalize just that.
    const norm = (s: string) => s.replace(/"savedAt": "[^"]*"/, '"savedAt": "X"');
    expect(norm(untouched)).toBe(norm(without));
    expect(JSON.parse(without)).not.toHaveProperty("mapViews");
    // …and a touched one does write it.
    expect(docOf({ datasets, mapViews: FULL })).toHaveProperty("mapViews");
  });

  it("drops malformed slices/annotations without throwing or losing the rest of the doc", () => {
    const doc = docOf({ datasets: [makeDataset("a", "rsm")], mapViews: { a: VIEW_A } });
    const mv = (doc.mapViews as Record<string, Record<string, unknown>>).a;
    mv.slices = [
      (mv.slices as unknown[])[0],
      { kind: "h", a: { x: 1, y: 2 }, width: 0, space: "angular" }, // no id
      { id: "x", kind: "seg", a: { x: 1, y: 2 }, width: 0, space: "q" }, // segment with no end
      { id: "y", kind: "diagonal", a: { x: 1, y: 2 }, width: 0, space: "q" }, // unknown kind
      { id: "z", kind: "h", a: { x: 1, y: 2 }, width: 0, space: "hkl" }, // unknown SPACE
      { id: "w", kind: "h", a: { x: 1, y: 2 }, width: -3, space: "q" }, // negative width
    ];
    mv.annotations = [
      { id: "ok", x: 1, y: 2, text: "keep", space: "q" },
      { id: "bad", x: 1, y: 2 }, // no text
    ];
    mv.colorLimits = [9000, 12.5]; // inverted — not a usable range
    const loaded = parseWorkspace(JSON.stringify(doc));
    expect(loaded.mapViews?.a?.slices.map((s) => s.id)).toEqual(["mslice-1"]);
    expect(loaded.mapViews?.a?.annotations.map((a) => a.id)).toEqual(["ok"]);
    expect(loaded.mapViews?.a?.colorLimits).toBeNull();
    expect(loaded.datasets).toHaveLength(1); // the rest of the doc is untouched
  });

  it("discards an entry keyed by a dataset this load did not keep", () => {
    const doc = docOf({ datasets: [makeDataset("a", "rsm")], mapViews: FULL });
    // `b` was serialized but its dataset is not in this document.
    expect(parseWorkspace(JSON.stringify(doc)).mapViews).toEqual({ a: VIEW_A });
  });

  // Review round 2, finding 12: `loadWorkspace` passed no live-id set, so a
  // hand-built WorkspaceState (tests, any future import path) could install an
  // entry naming a dataset the load does not have.
  it("loadWorkspace ALSO drops a dangling entry on a hand-built workspace", () => {
    useApp.getState().loadWorkspace({ datasets: [makeDataset("a", "rsm")], mapViews: FULL });
    expect(useApp.getState().mapViews).toEqual({ a: VIEW_A });
  });

  it("autosave fires when the map views are the ONLY thing that changed", () => {
    const base = { ...(useApp.getState() as unknown as AutosaveState), mapViews: EMPTY_MAP_VIEWS };
    expect(shouldAutosave(base, base)).toBe(false);
    expect(shouldAutosave({ ...base, mapViews: FULL }, base)).toBe(true);
  });

  it("Pack Project carries the map views (the same whole-state spread the .dwk save uses)", async () => {
    useApp
      .getState()
      .loadWorkspace({ datasets: [makeDataset("a", "rsm"), makeDataset("b", "other")] });
    useApp.setState({ mapViews: FULL });
    const packed = await serializeCurrentWorkspaceForPack();
    expect(packed.ok).toBe(true);
    if (!packed.ok) return;
    expect((JSON.parse(packed.content) as { mapViews: MapViewMap }).mapViews).toEqual(FULL);
  });
});
