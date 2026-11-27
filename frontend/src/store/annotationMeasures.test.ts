// The measurement shapes and the map's cell labels through the real store:
// each gesture is one undo step, and what is stored survives save / reopen
// (sanitizers and the .dwk pair), with the export wire carrying the same fields.
import { afterEach, describe, expect, it } from "vitest";

import { measureShapeActions } from "../components/Stage/annotationShapeActions";
import { newMeasureFields } from "../lib/annotationMeasure";
import { sanitizeFigureOverrides } from "../lib/figureOverridesSanitize";
import { liveViewOverrides } from "../lib/figureViewOverrides";
import { mapViewFor, sanitizeMapViews } from "../lib/mapView";
import { serializeMapViews } from "../lib/mapViewSerialize";
import { sanitizeShapes } from "../lib/plotviewDecor";
import { useApp } from "./useApp";

const ORIGINAL = useApp.getState();
afterEach(() => useApp.setState(ORIGINAL, true));

const run = (actionId: string, id: string) =>
  measureShapeActions.find((a) => a.id === actionId)!.run({ id, conv: null });
const measureActions = {
  toggleVertical: (id: string) => run("shape.scaleBarVertical", id),
  toggleTriangle: (id: string) => run("shape.slopeTriangle", id),
  toggleArc: (id: string) => run("shape.angleArc", id),
};

describe("measurement shapes in the store", () => {
  it("a drawn scale bar is one undo step and carries its length and direction", () => {
    const s = useApp.getState();
    const id = s.addShape({ kind: "scalebar", x1: 2, y1: 3, x2: 7, y2: 3, ...newMeasureFields("scalebar", 2, 3, 7, 3) });
    expect(useApp.getState().shapes).toEqual([
      { id, kind: "scalebar", x1: 2, y1: 3, x2: 7, y2: 3, orient: "h", length: 5 },
    ]);
    useApp.getState().undo();
    expect(useApp.getState().shapes).toEqual([]);
  });

  it("an angle keeps its second arm and moving it patches all three points in one step", () => {
    const id = useApp.getState().addShape({
      kind: "angle", x1: 0, y1: 0, x2: 1, y2: 0, ...newMeasureFields("angle", 0, 0, 1, 0, { x3: 0, y3: 1 }),
    });
    useApp.getState().updateShape(id, { x1: 5, y1: 5, x2: 6, y2: 5, x3: 5, y3: 6 });
    expect(useApp.getState().shapes[0]).toMatchObject({ x3: 5, y3: 6 });
    useApp.getState().undo();
    expect(useApp.getState().shapes[0]).toMatchObject({ x1: 0, x3: 0, y3: 1 });
  });

  it("the menu actions edit a scale bar's direction and a slope's triangle as single steps", () => {
    const bar = useApp.getState().addShape({ kind: "scalebar", x1: 1, y1: 1, x2: 4, y2: 1, orient: "h", length: 3 });
    const slope = useApp.getState().addShape({ kind: "slope", x1: 1, y1: 1, x2: 10, y2: 100 });
    measureActions.toggleVertical(bar);
    expect(useApp.getState().shapes.find((x) => x.id === bar)).toMatchObject({ orient: "v", length: 3, x2: 1, y2: 4 });
    measureActions.toggleTriangle(slope);
    expect(useApp.getState().shapes.find((x) => x.id === slope)?.triangle).toBe(true);
    useApp.getState().undo();
    expect(useApp.getState().shapes.find((x) => x.id === slope)?.triangle).toBeUndefined();
    useApp.getState().undo();
    expect(useApp.getState().shapes.find((x) => x.id === bar)).toMatchObject({ orient: "h", x2: 4, y2: 1 });
  });
});

describe("angle arc option", () => {
  const angle = { kind: "angle" as const, x1: 0, y1: 0, x2: 1, y2: 0, x3: 0, y3: 1 };
  it("is off for a new angle, toggles as one undo step, and only on an angle", () => {
    const id = useApp.getState().addShape(angle);
    const slope = useApp.getState().addShape({ kind: "slope", x1: 1, y1: 1, x2: 2, y2: 2 });
    const arc = measureShapeActions.find((a) => a.id === "shape.angleArc")!;
    expect(arc.hidden?.({ id, conv: null })).toBeFalsy();
    expect(arc.hidden?.({ id: slope, conv: null })).toBe(true);
    expect(arc.checked?.({ id, conv: null })).toBe(false);
    measureActions.toggleArc(id);
    expect(useApp.getState().shapes.find((x) => x.id === id)?.arc).toBe(true);
    expect(arc.checked?.({ id, conv: null })).toBe(true);
    useApp.getState().undo();
    expect(useApp.getState().shapes.find((x) => x.id === id)?.arc).toBeUndefined();
  });
  it("saves, reopens and reaches the export wire; a shape without it stays without it", () => {
    const shapes = [{ id: "a", ...angle, arc: true }, { id: "b", ...angle }];
    const back = sanitizeShapes(JSON.parse(JSON.stringify(shapes)));
    expect(back[0].arc).toBe(true);
    expect("arc" in back[1]).toBe(false);
    useApp.setState({ shapes: shapes as never });
    const wire = liveViewOverrides(() => useApp.getState())?.shapes ?? [];
    expect(wire[0]).toMatchObject({ kind: "angle", arc: true });
    expect("arc" in wire[1]).toBe(false);
    expect(sanitizeFigureOverrides({ shapes: wire })?.shapes).toEqual(wire);
  });
});

describe("measurement shapes persist", () => {
  const shapes = [
    { id: "a", kind: "slope", x1: 1, y1: 2, x2: 3, y2: 4, triangle: true, anchor: "page", stroke: "#f00" },
    { id: "b", kind: "angle", x1: 0, y1: 0, x2: 1, y2: 0, x3: 0, y3: 1 },
    { id: "c", kind: "scalebar", x1: 0, y1: 0, x2: 5, y2: 0, length: 5, orient: "h", text: "5 nm" },
    { id: "d", kind: "distance", x1: 0, y1: 0, x2: 3, y2: 4 },
  ];

  it("reopen keeps every field and forces a measurement onto the data anchor", () => {
    const back = sanitizeShapes(JSON.parse(JSON.stringify(shapes)));
    expect(back).toHaveLength(4);
    expect(back[0]).toMatchObject({ kind: "slope", triangle: true, stroke: "#f00" });
    expect(back[0].anchor).toBeUndefined();
    expect(back[1]).toMatchObject({ x3: 0, y3: 1 });
    expect(back[2]).toMatchObject({ length: 5, orient: "h", text: "5 nm" });
  });

  it("an angle without its second arm is dropped rather than guessed", () => {
    expect(sanitizeShapes([{ id: "x", kind: "angle", x1: 0, y1: 0, x2: 1, y2: 1 }])).toEqual([]);
  });

  it("the export wire carries the same fields, and the override sanitizer keeps them", () => {
    useApp.setState({ shapes: shapes as never });
    const wire = liveViewOverrides(() => useApp.getState())?.shapes ?? [];
    expect(wire).toHaveLength(4);
    expect(wire[0]).toMatchObject({ kind: "slope", triangle: true });
    expect(wire[0].anchor).toBeUndefined();
    expect(wire[1]).toMatchObject({ x3: 0, y3: 1 });
    expect(wire[2]).toMatchObject({ length: 5, orient: "h", text: "5 nm" });
    expect(sanitizeFigureOverrides({ shapes: wire })?.shapes).toEqual(wire);
  });
});

describe("map cell labels", () => {
  it("toggle, edit and undo as one step each, and round-trip the saved view", () => {
    const id = "ds-1";
    const view = () => mapViewFor(useApp.getState().mapViews, id);
    useApp.getState().setMapCellLabels(id, { format: "fixed", precision: 2 });
    useApp.getState().setMapCellLabels(id, { format: "fixed", precision: 2 }); // no change: no step
    expect(view().cellLabels).toEqual({ format: "fixed", precision: 2 });
    useApp.getState().setMapCellLabels(id, { format: "scientific", precision: 1 });
    useApp.getState().undo();
    expect(view().cellLabels).toEqual({ format: "fixed", precision: 2 });
    const saved = JSON.parse(JSON.stringify(serializeMapViews(useApp.getState().mapViews)));
    expect(sanitizeMapViews(saved)[id].cellLabels).toEqual({ format: "fixed", precision: 2 });
    useApp.getState().setMapCellLabels(id, undefined);
    expect(view().cellLabels).toBeUndefined();
    useApp.getState().undo();
    expect(view().cellLabels).toEqual({ format: "fixed", precision: 2 });
  });
});
