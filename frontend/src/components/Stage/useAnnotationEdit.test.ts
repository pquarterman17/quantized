// useAnnotationEdit — the MAIN #18 pointer-mode bridge + object-menu hook.
// Same renderHook/fireEvent convention as useGadgetChip.test.ts.

import { fireEvent, renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { askParams } from "../overlays/ParamDialog";
import { useApp } from "../../store/useApp";
import { useAnnotationEdit } from "./useAnnotationEdit";

vi.mock("../overlays/ParamDialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../overlays/ParamDialog")>()),
  askParams: vi.fn(),
}));

const mockAskParams = vi.mocked(askParams);

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    annotations: [{ id: "a1", x: 1, y: 2, text: "Tc" }],
    selectedAnnotationId: null,
    legendXY: null,
  });
});

describe("useAnnotationEdit — bridge gating", () => {
  it("is null outside pointer mode", () => {
    const { result } = renderHook(() => useAnnotationEdit("zoom"));
    expect(result.current.bridge).toBeNull();
  });

  it("is null in pointer mode with no annotations", () => {
    useApp.setState({ annotations: [] });
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    expect(result.current.bridge).toBeNull();
  });

  it("is a bridge carrying the current selection in pointer mode with annotations present", () => {
    useApp.setState({ selectedAnnotationId: "a1" });
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    expect(result.current.bridge?.selectedId).toBe("a1");
  });
});

describe("useAnnotationEdit — bridge callbacks", () => {
  it("onSelect updates the store's selectedAnnotationId", () => {
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onSelect?.("a1"));
    expect(useApp.getState().selectedAnnotationId).toBe("a1");
  });

  it("onMove commits x/y via updateAnnotation", () => {
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onMove?.("a1", 10, 20));
    expect(useApp.getState().annotations[0]).toMatchObject({ x: 10, y: 20 });
  });

  it("onResize commits a clamped size via updateAnnotation", () => {
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onResize?.("a1", 999));
    expect(useApp.getState().annotations[0].size).toBe(72); // MAX_ANNOTATION_SIZE
  });

  it("onEditText opens the dialog and commits the resolved text", async () => {
    mockAskParams.mockResolvedValue({ text: "New label" });
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onEditText?.("a1"));
    expect(mockAskParams).toHaveBeenCalledWith("Edit annotation text", [
      expect.objectContaining({ key: "text", default: "Tc" }),
    ]);
    await waitFor(() => expect(useApp.getState().annotations[0].text).toBe("New label"));
  });

  it("onEditText leaves the text untouched on cancel (askParams resolves null)", async () => {
    mockAskParams.mockResolvedValue(null);
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onEditText?.("a1"));
    await Promise.resolve();
    expect(useApp.getState().annotations[0].text).toBe("Tc");
  });
});

describe("useAnnotationEdit — object menu (right-click)", () => {
  it("onContextMenu opens a menu with Edit/Size+/Size-/Delete", () => {
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("a1", 40, 60));
    expect(result.current.menu).toMatchObject({ x: 40, y: 60 });
    const labels = result.current.menu?.items.map((i) => ("label" in i ? i.label : undefined));
    expect(labels).toEqual(expect.arrayContaining(["Edit text…", "Size +", "Size −", "Delete"]));
  });

  it("the Delete entry removes the annotation and clears the selection", () => {
    useApp.setState({ selectedAnnotationId: "a1" });
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("a1", 0, 0));
    const del = result.current.menu?.items.find((i) => "label" in i && i.label === "Delete");
    act(() => (del as { run: () => void }).run());
    expect(useApp.getState().annotations).toEqual([]);
    expect(useApp.getState().selectedAnnotationId).toBeNull();
  });

  it("closeMenu clears the menu state", () => {
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("a1", 0, 0));
    expect(result.current.menu).not.toBeNull();
    act(() => result.current.closeMenu());
    expect(result.current.menu).toBeNull();
  });
});

describe("useAnnotationEdit — Escape deselects", () => {
  it("clears selectedAnnotationId on Escape while something is selected", () => {
    useApp.setState({ selectedAnnotationId: "a1" });
    renderHook(() => useAnnotationEdit("pointer"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().selectedAnnotationId).toBeNull();
  });

  it("is a no-op when nothing is selected", () => {
    renderHook(() => useAnnotationEdit("pointer"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().selectedAnnotationId).toBeNull();
  });
});
