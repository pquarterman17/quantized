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

import { DEFAULT_MAP_VIEW, type MapViewState } from "./mapView";
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
const FULL: MapViewState = {
  datasetId: "a",
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

describe("map view `.dwk` persistence (P2.8)", () => {
  it("round-trips colour limits, scale, colormap, every slice position and the annotations", () => {
    const loaded = parseWorkspace(
      serializeWorkspace({ datasets: [makeDataset("a", "rsm")], mapView: FULL }),
    );
    expect(loaded.mapView).toEqual(FULL);
  });

  it("a saved view reaches the STORE on reopen, not just the parse result", () => {
    const text = serializeWorkspace({ datasets: [makeDataset("a", "rsm")], mapView: FULL });
    useApp.setState({ mapView: DEFAULT_MAP_VIEW });
    useApp.getState().loadWorkspace(parseWorkspace(text));
    expect(useApp.getState().mapView).toEqual(FULL);
  });

  it("opening a project whose doc has no map view CLEARS the previous project's one", () => {
    // The cross-project leak `loadWorkspace`'s own `workbooks` comment warns
    // about: a stale colour limit and slice positions are in another map's
    // units, so they must not survive an Open.
    useApp.getState().loadWorkspace(
      parseWorkspace(serializeWorkspace({ datasets: [makeDataset("a", "rsm")], mapView: FULL })),
    );
    expect(useApp.getState().mapView.slices).toHaveLength(3);

    useApp.getState().loadWorkspace(
      parseWorkspace(serializeWorkspace({ datasets: [makeDataset("b", "other")] })),
    );
    expect(useApp.getState().mapView).toEqual(DEFAULT_MAP_VIEW);
  });

  it("a pre-P2.8 doc (no field at all) loads as the default view", () => {
    const loaded = parseWorkspace(serializeWorkspace({ datasets: [makeDataset("a", "rsm")] }));
    expect(loaded.mapView).toEqual(DEFAULT_MAP_VIEW);
  });

  it("BYTE-COMPATIBILITY: an untouched map view writes no field at all", () => {
    const datasets = [makeDataset("a", "rsm")];
    const without = serializeWorkspace({ datasets });
    const untouched = serializeWorkspace({ datasets, mapView: DEFAULT_MAP_VIEW });
    // `savedAt` is a fresh timestamp on every call — normalize just that.
    const norm = (s: string) => s.replace(/"savedAt": "[^"]*"/, '"savedAt": "X"');
    expect(norm(untouched)).toBe(norm(without));
    expect(JSON.parse(without)).not.toHaveProperty("mapView");
    // …and a touched one does write it.
    expect(JSON.parse(serializeWorkspace({ datasets, mapView: FULL }))).toHaveProperty("mapView");
  });

  it("does not alias the live store object into the saved document", () => {
    const doc = JSON.parse(
      serializeWorkspace({ datasets: [makeDataset("a", "rsm")], mapView: FULL }),
    ) as { mapView: MapViewState };
    expect(doc.mapView).toEqual(FULL);
    expect(doc.mapView.slices[0]).not.toBe(FULL.slices[0]);
  });

  it("drops malformed slices/annotations without throwing or losing the rest of the doc", () => {
    const doc = JSON.parse(
      serializeWorkspace({ datasets: [makeDataset("a", "rsm")], mapView: FULL }),
    ) as Record<string, unknown>;
    const mv = doc.mapView as Record<string, unknown>;
    mv.slices = [
      (mv.slices as unknown[])[0],
      { kind: "h", a: { x: 1, y: 2 }, width: 0, space: "angular" }, // no id
      { id: "x", kind: "seg", a: { x: 1, y: 2 }, width: 0, space: "q" }, // segment with no end
      { id: "y", kind: "diagonal", a: { x: 1, y: 2 }, width: 0, space: "q" }, // unknown kind
    ];
    mv.annotations = [
      { id: "ok", x: 1, y: 2, text: "keep", space: "q" },
      { id: "bad", x: 1, y: 2 }, // no text
    ];
    mv.colorLimits = [9000, 12.5]; // inverted — not a usable range
    const loaded = parseWorkspace(JSON.stringify(doc));
    expect(loaded.mapView?.slices.map((s) => s.id)).toEqual(["mslice-1"]);
    expect(loaded.mapView?.annotations.map((a) => a.id)).toEqual(["ok"]);
    expect(loaded.mapView?.colorLimits).toBeNull();
    expect(loaded.datasets).toHaveLength(1); // the rest of the doc is untouched
  });

  it("discards a view bound to a dataset this load did not keep", () => {
    const doc = JSON.parse(
      serializeWorkspace({ datasets: [makeDataset("a", "rsm")], mapView: FULL }),
    ) as Record<string, unknown>;
    (doc.mapView as Record<string, unknown>).datasetId = "gone";
    expect(parseWorkspace(JSON.stringify(doc)).mapView).toEqual(DEFAULT_MAP_VIEW);
  });

  it("autosave fires when the map view is the ONLY thing that changed", () => {
    const base = { ...(useApp.getState() as unknown as AutosaveState), mapView: DEFAULT_MAP_VIEW };
    expect(shouldAutosave(base, base)).toBe(false);
    expect(shouldAutosave({ ...base, mapView: FULL }, base)).toBe(true);
  });

  it("Pack Project carries the map view (the same whole-state spread the .dwk save uses)", async () => {
    useApp.getState().loadWorkspace({ datasets: [makeDataset("a", "rsm")] });
    useApp.setState({ mapView: FULL });
    const packed = await serializeCurrentWorkspaceForPack();
    expect(packed.ok).toBe(true);
    if (!packed.ok) return;
    expect((JSON.parse(packed.content) as { mapView: MapViewState }).mapView).toEqual(FULL);
  });
});
