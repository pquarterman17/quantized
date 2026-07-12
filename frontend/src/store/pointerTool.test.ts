// store/pointerTool — the MAIN #18 slice: free legend position + the
// annotation-edit commit action. Exercised through the composed useApp store
// (same convention as history.test.ts/reductions' own slice tests) since the
// factory itself needs `s.annotations` from the main store literal.

import { afterEach, describe, expect, it } from "vitest";

import { MAX_ANNOTATION_SIZE, MIN_ANNOTATION_SIZE } from "../lib/uplotOverlays";
import { useApp } from "./useApp";

const ORIGINAL = useApp.getState();

afterEach(() => {
  useApp.setState(ORIGINAL, true);
});

describe("legendXY (MAIN #18 — free legend position)", () => {
  it("defaults to null", () => {
    expect(useApp.getState().legendXY).toBeNull();
  });

  it("setLegendXY sets and clears it", () => {
    useApp.getState().setLegendXY([0.2, 0.8]);
    expect(useApp.getState().legendXY).toEqual([0.2, 0.8]);
    useApp.getState().setLegendXY(null);
    expect(useApp.getState().legendXY).toBeNull();
  });
});

describe("axisLabelOffsets (draggable axis titles)", () => {
  it("defaults to empty", () => {
    expect(useApp.getState().axisLabelOffsets).toEqual({});
  });

  it("setAxisLabelOffset moves one axis and resets it (null) without touching others", () => {
    useApp.getState().setAxisLabelOffset("y", [-12, 4]);
    useApp.getState().setAxisLabelOffset("x", [0, 8]);
    expect(useApp.getState().axisLabelOffsets).toEqual({ y: [-12, 4], x: [0, 8] });
    useApp.getState().setAxisLabelOffset("y", null); // reset
    expect(useApp.getState().axisLabelOffsets).toEqual({ x: [0, 8] });
  });
});

describe("axisLabelStyles (Format menu: size/italic/bold)", () => {
  it("defaults empty, merges patches, and drops an emptied style back to default", () => {
    expect(useApp.getState().axisLabelStyles).toEqual({});
    useApp.getState().setAxisLabelStyle("y", { size: 16 });
    useApp.getState().setAxisLabelStyle("y", { italic: true });
    expect(useApp.getState().axisLabelStyles).toEqual({ y: { size: 16, italic: true } });
    useApp.getState().setAxisLabelStyle("y", { italic: false }); // toggle off
    expect(useApp.getState().axisLabelStyles).toEqual({ y: { size: 16 } });
    useApp.getState().setAxisLabelStyle("y", { size: undefined }); // reset format
    expect(useApp.getState().axisLabelStyles).toEqual({}); // fully emptied -> removed
  });
});

describe("selectedAnnotationId (MAIN #18 — pointer-mode selection)", () => {
  it("defaults to null and round-trips through the setter", () => {
    expect(useApp.getState().selectedAnnotationId).toBeNull();
    useApp.getState().setSelectedAnnotationId("ann-3");
    expect(useApp.getState().selectedAnnotationId).toBe("ann-3");
  });
});

describe("updateAnnotation (MAIN #18 — commit-once drag/resize/text-edit)", () => {
  it("patches x/y/text on the matching annotation, leaving others untouched", () => {
    useApp.setState({
      annotations: [
        { id: "a1", x: 1, y: 2, text: "Tc" },
        { id: "a2", x: 3, y: 4, text: "Hc" },
      ],
    });
    useApp.getState().updateAnnotation("a1", { x: 10, y: 20 });
    expect(useApp.getState().annotations).toEqual([
      { id: "a1", x: 10, y: 20, text: "Tc" },
      { id: "a2", x: 3, y: 4, text: "Hc" },
    ]);
  });

  it("clamps a size patch to [MIN_ANNOTATION_SIZE, MAX_ANNOTATION_SIZE]", () => {
    useApp.setState({ annotations: [{ id: "a1", x: 1, y: 2, text: "Tc" }] });
    useApp.getState().updateAnnotation("a1", { size: 999 });
    expect(useApp.getState().annotations[0].size).toBe(MAX_ANNOTATION_SIZE);
    useApp.getState().updateAnnotation("a1", { size: -5 });
    expect(useApp.getState().annotations[0].size).toBe(MIN_ANNOTATION_SIZE);
  });

  it("is a no-op for an unknown id", () => {
    useApp.setState({ annotations: [{ id: "a1", x: 1, y: 2, text: "Tc" }] });
    useApp.getState().updateAnnotation("ghost", { x: 99 });
    expect(useApp.getState().annotations).toEqual([{ id: "a1", x: 1, y: 2, text: "Tc" }]);
  });

  // MAIN #21: the page/data anchor toggle patches `anchor` alongside x/y in
  // ONE commit (see useAnnotationEdit.togglePageAnchor) — the same
  // commit-once discipline the drag/resize/text-edit patches above already
  // exercise, extended to this new field.
  it("patches anchor alongside x/y for the page/data toggle", () => {
    useApp.setState({ annotations: [{ id: "a1", x: 1, y: 2, text: "Tc" }] });
    useApp.getState().updateAnnotation("a1", { anchor: "page", x: 0.4, y: 0.6 });
    expect(useApp.getState().annotations[0]).toEqual({ id: "a1", x: 0.4, y: 0.6, text: "Tc", anchor: "page" });
    useApp.getState().updateAnnotation("a1", { anchor: "data", x: 1, y: 2 });
    expect(useApp.getState().annotations[0]).toMatchObject({ anchor: "data", x: 1, y: 2 });
  });
});
