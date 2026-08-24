// annotationShapeActions — the GUI_INTERACTION #8 registry entries behind
// the annotation/shape object menus (useAnnotationEdit/useShapeEdit), the
// ⌘K palette (lib/paletteContextActions) and the selection mini-toolbar.
// Exercises the entries directly against a target — same store-seeded
// convention as useShapeEdit.test.ts / useAnnotationEdit.test.ts, which
// already cover these entries indirectly through the hooks' rendered menus.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { askAnnotationText } from "../../store/annotationTextDialog";
import { useApp } from "../../store/useApp";
import {
  annotationDeleteAction,
  annotationEditActions,
  annotationSizeActions,
  createAnnotationFromDialog,
  shapeToggleActions,
  type AnnotationActionTarget,
  type ShapeActionTarget,
} from "./annotationShapeActions";

vi.mock("../../store/annotationTextDialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../store/annotationTextDialog")>()),
  askAnnotationText: vi.fn(),
}));

const mockAskAnnotationText = vi.mocked(askAnnotationText);

const CONV = { toPage: { x: 0.4, y: 0.6 }, toData: { x: 5, y: 9 } };

beforeEach(() => {
  vi.clearAllMocks();
  mockAskAnnotationText.mockResolvedValue(null);
  useApp.setState({
    annotations: [{ id: "a1", x: 1, y: 2, text: "Tc" }],
    selectedAnnotationId: null,
    shapes: [{ id: "s1", kind: "rect", x1: 1, y1: 2, x2: 3, y2: 4 }],
    selectedShapeId: null,
    plotTool: "zoom",
    history: [],
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

// createAnnotationFromDialog — the single dialog->guard->create->select
// sequence PlotContextMenu's "Add text here…" and useShapeDraw's "Text box"
// commit both delegate to (B4). Exercised directly here so the shared
// helper's own contract (B1's tool-flip-on-success-only ruling; B3's blank-
// text guard) is pinned independent of either call site.
describe("createAnnotationFromDialog", () => {
  // This describe's own tests care about annotations/history CREATED BY
  // createAnnotationFromDialog, not the outer file's pin-toggle seed data —
  // start each one from a clean slate.
  beforeEach(() => {
    useApp.setState({ annotations: [], selectedAnnotationId: null, history: [] });
  });

  it("creates the annotation at (x, y) with the resolved text and selects it", async () => {
    mockAskAnnotationText.mockResolvedValue("Tc onset");
    const id = await createAnnotationFromDialog({ x: 3, y: 4, title: "Add text" });
    expect(id).not.toBeNull();
    expect(useApp.getState().annotations).toEqual([
      expect.objectContaining({ id, x: 3, y: 4, text: "Tc onset" }),
    ]);
    expect(useApp.getState().selectedAnnotationId).toBe(id);
  });

  it("B1: flips the plot tool to pointer only when flipToPointer is set AND the create succeeds", async () => {
    mockAskAnnotationText.mockResolvedValue("Tc onset");
    useApp.setState({ plotTool: "zoom" });
    await createAnnotationFromDialog({ x: 0, y: 0, title: "Add text", flipToPointer: true });
    expect(useApp.getState().plotTool).toBe("pointer");
  });

  it("B1: does NOT flip the tool when flipToPointer is omitted (useShapeDraw already flipped it itself)", async () => {
    mockAskAnnotationText.mockResolvedValue("Tc onset");
    useApp.setState({ plotTool: "zoom" });
    await createAnnotationFromDialog({ x: 0, y: 0, title: "Text box" });
    expect(useApp.getState().plotTool).toBe("zoom");
  });

  it("B1: does NOT flip the tool on cancel even when flipToPointer is set", async () => {
    mockAskAnnotationText.mockResolvedValue(null);
    useApp.setState({ plotTool: "zoom" });
    const id = await createAnnotationFromDialog({ x: 0, y: 0, title: "Add text", flipToPointer: true });
    expect(id).toBeNull();
    expect(useApp.getState().plotTool).toBe("zoom");
  });

  it("B3: resolves null and creates nothing when the dialog is cancelled", async () => {
    mockAskAnnotationText.mockResolvedValue(null);
    const id = await createAnnotationFromDialog({ x: 0, y: 0, title: "Add text" });
    expect(id).toBeNull();
    expect(useApp.getState().annotations).toEqual([]);
    expect(useApp.getState().history).toEqual([]);
  });

  it("B3: resolves null and creates nothing when the dialog resolves an empty string", async () => {
    mockAskAnnotationText.mockResolvedValue("");
    const id = await createAnnotationFromDialog({ x: 0, y: 0, title: "Add text" });
    expect(id).toBeNull();
    expect(useApp.getState().annotations).toEqual([]);
    expect(useApp.getState().history).toEqual([]);
  });

  it("B3: resolves null and creates nothing when the dialog resolves whitespace-only text", async () => {
    mockAskAnnotationText.mockResolvedValue("   ");
    const id = await createAnnotationFromDialog({ x: 0, y: 0, title: "Add text" });
    expect(id).toBeNull();
    expect(useApp.getState().annotations).toEqual([]);
    expect(useApp.getState().history).toEqual([]);
  });

  it("applies an optional frame patch to the newly created annotation", async () => {
    mockAskAnnotationText.mockResolvedValue("Hc2");
    const id = await createAnnotationFromDialog({ x: 5, y: 6, title: "Text box", frame: { opacity: 0.9 } });
    const ann = useApp.getState().annotations.find((a) => a.id === id);
    expect(ann?.frame).toEqual({ opacity: 0.9 });
  });
});
