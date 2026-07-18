// annotationShapeActions — the GUI_INTERACTION #8 registry entries behind
// the annotation/shape object menus (useAnnotationEdit/useShapeEdit), the
// ⌘K palette (lib/paletteContextActions) and the selection mini-toolbar.
// Exercises the entries directly against a target — same store-seeded
// convention as useShapeEdit.test.ts / useAnnotationEdit.test.ts, which
// already cover these entries indirectly through the hooks' rendered menus.

import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../../store/useApp";
import {
  annotationDeleteAction,
  annotationEditActions,
  annotationSizeActions,
  shapeToggleActions,
  type AnnotationActionTarget,
  type ShapeActionTarget,
} from "./annotationShapeActions";

const CONV = { toPage: { x: 0.4, y: 0.6 }, toData: { x: 5, y: 9 } };

beforeEach(() => {
  useApp.setState({
    annotations: [{ id: "a1", x: 1, y: 2, text: "Tc" }],
    selectedAnnotationId: null,
    shapes: [{ id: "s1", kind: "rect", x1: 1, y1: 2, x2: 3, y2: 4 }],
    selectedShapeId: null,
  });
});

describe("annotationShapeActions — pin toggle conv gating", () => {
  it("hides the pin toggle when conv is null (palette/mini-toolbar callers)", () => {
    const pin = annotationEditActions.find((a) => a.id === "annotation.pinToggle")!;
    const target: AnnotationActionTarget = { id: "a1", conv: null };
    expect(pin.hidden?.(target)).toBe(true);
  });

  it("shows the pin toggle when a live canvas conv is supplied", () => {
    const pin = annotationEditActions.find((a) => a.id === "annotation.pinToggle")!;
    const target: AnnotationActionTarget = { id: "a1", conv: CONV };
    expect(pin.hidden?.(target)).toBe(false);
  });
});

describe("annotationShapeActions — delete", () => {
  it("removes the annotation and clears selectedAnnotationId", () => {
    useApp.setState({ selectedAnnotationId: "a1" });
    annotationDeleteAction.run({ id: "a1", conv: null });
    expect(useApp.getState().annotations).toEqual([]);
    expect(useApp.getState().selectedAnnotationId).toBeNull();
  });
});

describe("annotationShapeActions — size gating", () => {
  it("sizeUp is disabled once size reaches MAX_ANNOTATION_SIZE (72)", () => {
    useApp.setState({ annotations: [{ id: "a1", x: 1, y: 2, text: "Tc", size: 72 }] });
    const sizeUp = annotationSizeActions.find((a) => a.id === "annotation.sizeUp")!;
    expect(sizeUp.enabled?.({ id: "a1", conv: null })).toBe(false);
  });

  it("sizeUp is enabled below MAX_ANNOTATION_SIZE", () => {
    useApp.setState({ annotations: [{ id: "a1", x: 1, y: 2, text: "Tc", size: 20 }] });
    const sizeUp = annotationSizeActions.find((a) => a.id === "annotation.sizeUp")!;
    expect(sizeUp.enabled?.({ id: "a1", conv: null })).toBe(true);
  });

  it("sizeDown is disabled once size reaches MIN_ANNOTATION_SIZE (6)", () => {
    useApp.setState({ annotations: [{ id: "a1", x: 1, y: 2, text: "Tc", size: 6 }] });
    const sizeDown = annotationSizeActions.find((a) => a.id === "annotation.sizeDown")!;
    expect(sizeDown.enabled?.({ id: "a1", conv: null })).toBe(false);
  });
});

describe("annotationShapeActions — shape dashed toggle", () => {
  it("checked reflects the shape's dash state and run() toggles it", () => {
    const dashed = shapeToggleActions.find((a) => a.id === "shape.dashed")!;
    const target: ShapeActionTarget = { id: "s1", conv: null };
    expect(dashed.checked?.(target)).toBe(false);
    dashed.run(target);
    expect(useApp.getState().shapes[0].dash).toBe(true);
    expect(dashed.checked?.(target)).toBe(true);
    dashed.run(target);
    expect(useApp.getState().shapes[0].dash).toBe(false);
  });
});

describe("annotationShapeActions — shape pin toggle conv gating", () => {
  it("hides for conv null, shows with a conv", () => {
    const pin = shapeToggleActions.find((a) => a.id === "shape.pinToggle")!;
    expect(pin.hidden?.({ id: "s1", conv: null })).toBe(true);
    const shapeConv = { toPage: { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 }, toData: { x1: 5, y1: 6, x2: 7, y2: 8 } };
    expect(pin.hidden?.({ id: "s1", conv: shapeConv })).toBe(false);
  });
});
