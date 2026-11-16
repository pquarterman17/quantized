// UX-A: one selection at a time across plot objects, annotations and shapes.

import { beforeEach, describe, expect, it } from "vitest";

import { clearAllSelection, parseSelectionKey, selectPlotObject, selectionKey, usePlotSelection } from "./plotSelection";
import { useApp } from "./useApp";

beforeEach(() => {
  usePlotSelection.setState({ sel: null });
  useApp.setState({ selectedAnnotationId: null, selectedShapeId: null });
});

describe("plot selection", () => {
  it("selecting a plot object drops the annotation and shape selections", () => {
    useApp.setState({ selectedAnnotationId: "a1", selectedShapeId: "s1" });
    selectPlotObject({ kind: "axis", axis: "x" });
    expect(useApp.getState().selectedAnnotationId).toBeNull();
    expect(useApp.getState().selectedShapeId).toBeNull();
  });

  it("clearAllSelection clears every kind", () => {
    selectPlotObject({ kind: "legend" });
    useApp.setState({ selectedShapeId: "s1" });
    clearAllSelection();
    expect(usePlotSelection.getState().sel).toBeNull();
    expect(useApp.getState().selectedShapeId).toBeNull();
  });

  it("keys round-trip", () => {
    for (const sel of [{ kind: "series", channel: 3 }, { kind: "axis", axis: "y2" }, { kind: "legend" }] as const)
      expect(parseSelectionKey(selectionKey(sel))).toEqual(sel);
    expect(parseSelectionKey("")).toBeNull();
    expect(parseSelectionKey("axis:z")).toBeNull();
  });
});
