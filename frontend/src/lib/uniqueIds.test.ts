// A project saved by a build whose plot-object counters restarted on every
// page load can already hold two objects with one id (`ann-1` twice), and
// every edit and delete is keyed by id: one delete removed both. Reopening
// such a project must make them separately addressable again.

import { describe, expect, it } from "vitest";

import { sanitizeMapView } from "./mapView";
import { sanitizePlotView } from "./plotview";
import { uniqueIds } from "./uniqueIds";

describe("uniqueIds", () => {
  it("keeps the first holder of an id and re-keys each repeat", () => {
    const out = uniqueIds([{ id: "a" }, { id: "a" }, { id: "b" }, { id: "a" }]);
    expect(out.map((e) => e.id)).toEqual(["a", "a~2", "b", "a~3"]);
  });

  it("never re-keys onto an id another entry already holds", () => {
    const out = uniqueIds([{ id: "a" }, { id: "a~2" }, { id: "a" }]);
    expect(new Set(out.map((e) => e.id)).size).toBe(3);
  });

  it("returns the same list when every id is already unique", () => {
    const list = [{ id: "a" }, { id: "b" }];
    expect(uniqueIds(list)).toBe(list);
  });
});

describe("a reopened view's plot objects are separately addressable", () => {
  it("plot view: reference lines, annotations, shapes and region shades", () => {
    const view = sanitizePlotView({
      refLines: [
        { id: "ref-1", axis: "x", value: 1 },
        { id: "ref-1", axis: "y", value: 2 },
      ],
      annotations: [
        { id: "ann-1", x: 1, y: 1, text: "old" },
        { id: "ann-1", x: 2, y: 2, text: "new" },
      ],
      shapes: [
        { id: "shape-1", kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1 },
        { id: "shape-1", kind: "line", x1: 0, y1: 0, x2: 2, y2: 2 },
      ],
      regionShades: [
        { id: "shade-1", x1: 0, x2: 1, y1: 0, y2: 1, fill: "#336699" },
        { id: "shade-1", x1: 2, x2: 3, y1: 0, y2: 1, fill: "#993366" },
      ],
    });
    for (const list of [view.refLines, view.annotations, view.shapes, view.regionShades]) {
      expect(list).toHaveLength(2);
      expect(new Set(list.map((e) => e.id)).size).toBe(2);
    }
    expect(view.annotations.map((a) => a.text)).toEqual(["old", "new"]);
  });

  it("map view: slices and annotations", () => {
    const view = sanitizeMapView({
      slices: [
        { id: "mslice-1", kind: "h", a: { x: 0, y: 1 }, width: 0, space: "q" },
        { id: "mslice-1", kind: "v", a: { x: 2, y: 0 }, width: 0, space: "q" },
      ],
      annotations: [
        { id: "mann-1", x: 0, y: 0, text: "old", space: null },
        { id: "mann-1", x: 1, y: 1, text: "new", space: null },
      ],
    });
    expect(new Set(view.slices.map((s) => s.id)).size).toBe(2);
    expect(new Set(view.annotations.map((a) => a.id)).size).toBe(2);
  });
});
