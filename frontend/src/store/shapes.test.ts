// store/shapes — the MAIN #27 slice: the drawn-shapes array + draw/select
// tool state. Exercised through the composed useApp store (same convention
// as pointerTool.test.ts).

import { afterEach, describe, expect, it } from "vitest";

import { useApp } from "./useApp";

const ORIGINAL = useApp.getState();

afterEach(() => {
  useApp.setState(ORIGINAL, true);
});

describe("shapes (MAIN #27)", () => {
  it("starts empty", () => {
    expect(useApp.getState().shapes).toEqual([]);
  });

  it("addShape appends a shape with a fresh id and returns it", () => {
    const id = useApp.getState().addShape({ kind: "arrow", x1: 1, y1: 2, x2: 3, y2: 4 });
    expect(typeof id).toBe("string");
    expect(useApp.getState().shapes).toEqual([{ kind: "arrow", x1: 1, y1: 2, x2: 3, y2: 4, id }]);
  });

  it("addShape never reuses an id across calls", () => {
    const id1 = useApp.getState().addShape({ kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 });
    const id2 = useApp.getState().addShape({ kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 });
    expect(id1).not.toBe(id2);
  });

  it("updateShape patches the matching shape, leaving others untouched", () => {
    useApp.setState({
      shapes: [
        { id: "s1", kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1 },
        { id: "s2", kind: "ellipse", x1: 2, y1: 2, x2: 3, y2: 3 },
      ],
    });
    useApp.getState().updateShape("s1", { x2: 10, stroke: "#ff0000" });
    expect(useApp.getState().shapes).toEqual([
      { id: "s1", kind: "rect", x1: 0, y1: 0, x2: 10, y2: 1, stroke: "#ff0000" },
      { id: "s2", kind: "ellipse", x1: 2, y1: 2, x2: 3, y2: 3 },
    ]);
  });

  it("updateShape is a no-op for an unknown id", () => {
    useApp.setState({ shapes: [{ id: "s1", kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 }] });
    useApp.getState().updateShape("ghost", { x1: 99 });
    expect(useApp.getState().shapes).toEqual([{ id: "s1", kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 }]);
  });

  it("removeShape drops only the matching shape", () => {
    useApp.setState({
      shapes: [
        { id: "s1", kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 },
        { id: "s2", kind: "line", x1: 2, y1: 2, x2: 3, y2: 3 },
      ],
    });
    useApp.getState().removeShape("s1");
    expect(useApp.getState().shapes).toEqual([{ id: "s2", kind: "line", x1: 2, y1: 2, x2: 3, y2: 3 }]);
  });

  it("clearShapes empties the list and deselects", () => {
    useApp.setState({
      shapes: [{ id: "s1", kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 }],
      selectedShapeId: "s1",
    });
    useApp.getState().clearShapes();
    expect(useApp.getState().shapes).toEqual([]);
    expect(useApp.getState().selectedShapeId).toBeNull();
  });

  it("selectedShapeId defaults to null and round-trips through the setter", () => {
    expect(useApp.getState().selectedShapeId).toBeNull();
    useApp.getState().setSelectedShapeId("s3");
    expect(useApp.getState().selectedShapeId).toBe("s3");
    useApp.getState().setSelectedShapeId(null);
    expect(useApp.getState().selectedShapeId).toBeNull();
  });

  it("drawShapeKind defaults to null and round-trips through the setter, including 'textbox'", () => {
    expect(useApp.getState().drawShapeKind).toBeNull();
    useApp.getState().setDrawShapeKind("rect");
    expect(useApp.getState().drawShapeKind).toBe("rect");
    useApp.getState().setDrawShapeKind("textbox");
    expect(useApp.getState().drawShapeKind).toBe("textbox");
    useApp.getState().setDrawShapeKind(null);
    expect(useApp.getState().drawShapeKind).toBeNull();
  });
});
