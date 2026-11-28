// The polygon beside the box and ruler in the ROI slice: exclusivity, the saved form
// and the .dwk round trip (the forward-compat gate itself is in workspaceForwardCompat.test.ts).

import { beforeEach, describe, expect, it } from "vitest";

import type { RoiPolygon } from "../lib/roiPolygon";
import { deserializeRois, serializeRois } from "./roisCodec";
import { useApp } from "./useApp";

const poly: RoiPolygon = { space: "angular", points: [[30, 15], [34, 15], [32, 18]] };
const rect = { space: "angular" as const, x0: 0, x1: 1, y0: 0, y1: 1 };
const ruler = { space: "angular" as const, cx: 1, cy: 1, angle: 0, length: 2, width: 1 };

beforeEach(() => useApp.setState({ mapRoi: null, mapRuler: null, mapPolygon: null, savedRois: [], history: [], future: [] }));

describe("the polygon working shape", () => {
  it("is exclusive with the box and the ruler, whichever is set last", () => {
    const s = useApp.getState();
    s.setMapRoi(rect);
    s.setMapPolygon(poly);
    expect(useApp.getState().mapRoi).toBeNull();
    useApp.getState().setMapRuler(ruler);
    expect(useApp.getState().mapPolygon).toBeNull();
    useApp.getState().setMapPolygon(poly);
    expect(useApp.getState().mapRuler).toBeNull();
    useApp.getState().setMapRoi(rect);
    expect(useApp.getState().mapPolygon).toBeNull();
    useApp.getState().setMapRoi(null); // clearing one leaves the others alone
    expect(useApp.getState().mapRoi).toBeNull();
  });

  it("is not part of undo (a working shape, like the box)", () => {
    useApp.getState().setMapPolygon(poly);
    expect(useApp.getState().history).toHaveLength(0);
  });
});

describe("a saved polygon", () => {
  it("saves, applies back over another shape, and is one undo step", () => {
    useApp.getState().setMapPolygon(poly);
    const id = useApp.getState().saveRoi("region")!;
    expect(useApp.getState().savedRois[0]).toMatchObject({ id, name: "region", kind: "polygon", polygon: poly });
    useApp.getState().setMapRoi(rect);
    useApp.getState().applySavedRoi(id);
    expect(useApp.getState().mapPolygon).toEqual(poly);
    expect(useApp.getState().mapRoi).toBeNull();
    useApp.getState().undo();
    expect(useApp.getState().savedRois).toHaveLength(0);
  });

  it("is not saved from a plain map (the project file knows only the RSM spaces)", () => {
    useApp.getState().setMapPolygon({ space: "map", axes: ["A", "B"], points: poly.points });
    expect(useApp.getState().saveRoi("x")).toBeNull();
    expect(useApp.getState().savedRois).toHaveLength(0);
  });

  it("round-trips through the .dwk codec and drops a malformed entry with a warning", () => {
    useApp.getState().setMapPolygon(poly);
    useApp.getState().saveRoi("region");
    const json = JSON.parse(JSON.stringify(serializeRois(useApp.getState().savedRois)));
    const warnings: string[] = [];
    const back = deserializeRois(
      [...json,
        { id: "bad1", name: "two", kind: "polygon", polygon: { space: "angular", points: [[0, 0], [1, 1]] } },
        { id: "bad2", name: "map", kind: "polygon", polygon: { space: "map", points: poly.points } },
        { id: "bad3", name: "nan", kind: "polygon", polygon: { space: "q", points: [[0, 0], [1, null], [2, 2]] } }],
      warnings,
    );
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ kind: "polygon", polygon: poly });
    expect(warnings).toHaveLength(3);
  });
});
