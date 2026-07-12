// useShapeDraw — the MAIN #27 drag-to-draw-a-shape / place-a-text-box mode
// bridge. Same renderHook/act/fireEvent convention as useAnnotationEdit.test.ts.

import { fireEvent, renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { askAnnotationText } from "../overlays/AnnotationTextDialog";
import { useApp } from "../../store/useApp";
import { useShapeDraw } from "./useShapeDraw";

vi.mock("../overlays/AnnotationTextDialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../overlays/AnnotationTextDialog")>()),
  askAnnotationText: vi.fn(),
}));

const mockAskAnnotationText = vi.mocked(askAnnotationText);

beforeEach(() => {
  vi.clearAllMocks();
  mockAskAnnotationText.mockResolvedValue(null);
  useApp.setState({ drawShapeKind: null, shapes: [], annotations: [], status: "", plotTool: "zoom" });
});

describe("useShapeDraw — bridge gating", () => {
  it("is null with no draw mode active", () => {
    const { result } = renderHook(() => useShapeDraw());
    expect(result.current.shapeDraw).toBeNull();
  });

  it("is a bridge carrying the current drawShapeKind once a mode is picked", () => {
    useApp.setState({ drawShapeKind: "arrow" });
    const { result } = renderHook(() => useShapeDraw());
    expect(result.current.shapeDraw?.drawKind).toBe("arrow");
  });

  it("sets a status-line hint naming the active mode", () => {
    useApp.setState({ drawShapeKind: "rect" });
    renderHook(() => useShapeDraw());
    expect(useApp.getState().status).toMatch(/rectangle/i);
  });
});

describe("useShapeDraw — committing a real shape kind", () => {
  it("adds a shape and clears the mode (auto-return to pointer)", () => {
    useApp.setState({ drawShapeKind: "ellipse" });
    const { result } = renderHook(() => useShapeDraw());
    act(() => result.current.shapeDraw?.onDrawCommit?.("ellipse", 1, 2, 3, 4));
    expect(useApp.getState().shapes).toEqual([
      expect.objectContaining({ kind: "ellipse", x1: 1, y1: 2, x2: 3, y2: 4 }),
    ]);
    expect(useApp.getState().drawShapeKind).toBeNull();
  });

  it("selects the newly created shape", () => {
    useApp.setState({ drawShapeKind: "line" });
    const { result } = renderHook(() => useShapeDraw());
    act(() => result.current.shapeDraw?.onDrawCommit?.("line", 0, 0, 1, 1));
    const created = useApp.getState().shapes[0];
    expect(useApp.getState().selectedShapeId).toBe(created.id);
  });

  it("auto-returns to the pointer tool so the new shape is immediately editable", () => {
    useApp.setState({ drawShapeKind: "line", plotTool: "zoom" });
    const { result } = renderHook(() => useShapeDraw());
    act(() => result.current.shapeDraw?.onDrawCommit?.("line", 0, 0, 1, 1));
    expect(useApp.getState().plotTool).toBe("pointer");
  });
});

describe("useShapeDraw — committing a text box (MAIN #27's 'one text system')", () => {
  it("creates an ANNOTATION (not a Shape) with a default frame, and clears the mode immediately", () => {
    useApp.setState({ drawShapeKind: "textbox" });
    const { result } = renderHook(() => useShapeDraw());
    act(() => result.current.shapeDraw?.onDrawCommit?.("textbox", 5, 6, 5, 6));
    expect(useApp.getState().shapes).toEqual([]); // never a Shape
    expect(useApp.getState().annotations).toHaveLength(1);
    const ann = useApp.getState().annotations[0];
    expect(ann).toMatchObject({ x: 5, y: 6 });
    expect(ann.frame).toBeDefined();
    expect(useApp.getState().drawShapeKind).toBeNull();
    expect(useApp.getState().plotTool).toBe("pointer"); // auto-return
    expect(useApp.getState().selectedAnnotationId).toBe(ann.id);
  });

  it("immediately opens the text dialog and commits the resolved text", async () => {
    mockAskAnnotationText.mockResolvedValue("Hc2");
    useApp.setState({ drawShapeKind: "textbox" });
    const { result } = renderHook(() => useShapeDraw());
    act(() => result.current.shapeDraw?.onDrawCommit?.("textbox", 1, 1, 1, 1));
    expect(mockAskAnnotationText).toHaveBeenCalledWith("Text box", "");
    await waitFor(() => expect(useApp.getState().annotations[0].text).toBe("Hc2"));
  });

  it("leaves the text empty on cancel (askAnnotationText resolves null)", async () => {
    useApp.setState({ drawShapeKind: "textbox" });
    const { result } = renderHook(() => useShapeDraw());
    act(() => result.current.shapeDraw?.onDrawCommit?.("textbox", 1, 1, 1, 1));
    await Promise.resolve();
    expect(useApp.getState().annotations[0].text).toBe("");
  });
});

describe("useShapeDraw — Escape cancels the mode", () => {
  it("clears drawShapeKind on Escape while a mode is active", () => {
    useApp.setState({ drawShapeKind: "rect" });
    renderHook(() => useShapeDraw());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().drawShapeKind).toBeNull();
  });

  it("is a no-op when no mode is active", () => {
    renderHook(() => useShapeDraw());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().drawShapeKind).toBeNull();
  });
});
