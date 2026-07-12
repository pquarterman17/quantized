// useAnnotationEdit — the MAIN #18 pointer-mode bridge + object-menu hook.
// Same renderHook/fireEvent convention as useGadgetChip.test.ts.

import { fireEvent, renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { askAnnotationText } from "../overlays/AnnotationTextDialog";
import type { ContextMenuItem } from "../overlays/ContextMenu";
import { useApp } from "../../store/useApp";
import { useAnnotationEdit } from "./useAnnotationEdit";

vi.mock("../overlays/AnnotationTextDialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../overlays/AnnotationTextDialog")>()),
  askAnnotationText: vi.fn(),
}));

const mockAskAnnotationText = vi.mocked(askAnnotationText);

// A stand-in conv (MAIN #21) — the shape annotationAnchorConversions
// computes; the plugin's own round-trip is covered in uplotOverlays.test.ts,
// this file only needs a concrete value to feed the toggle action.
const CONV = { toPage: { x: 0.4, y: 0.6 }, toData: { x: 5, y: 9 } };

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
    mockAskAnnotationText.mockResolvedValue("New label");
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onEditText?.("a1"));
    expect(mockAskAnnotationText).toHaveBeenCalledWith("Edit annotation text", "Tc");
    await waitFor(() => expect(useApp.getState().annotations[0].text).toBe("New label"));
  });

  it("onEditText leaves the text untouched on cancel (askAnnotationText resolves null)", async () => {
    mockAskAnnotationText.mockResolvedValue(null);
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onEditText?.("a1"));
    await Promise.resolve();
    expect(useApp.getState().annotations[0].text).toBe("Tc");
  });
});

describe("useAnnotationEdit — object menu (right-click)", () => {
  it("onContextMenu opens a menu with Edit/Pin/Size+/Size-/Delete", () => {
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("a1", 40, 60, CONV));
    expect(result.current.menu).toMatchObject({ x: 40, y: 60 });
    const labels = result.current.menu?.items.map((i) => ("label" in i ? i.label : undefined));
    expect(labels).toEqual(
      expect.arrayContaining(["Edit text…", "Pin to page (stays on zoom)", "Size +", "Size −", "Delete"]),
    );
  });

  it("the Delete entry removes the annotation and clears the selection", () => {
    useApp.setState({ selectedAnnotationId: "a1" });
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("a1", 0, 0, CONV));
    const del = result.current.menu?.items.find((i) => "label" in i && i.label === "Delete");
    act(() => (del as { run: () => void }).run());
    expect(useApp.getState().annotations).toEqual([]);
    expect(useApp.getState().selectedAnnotationId).toBeNull();
  });

  it("closeMenu clears the menu state", () => {
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("a1", 0, 0, CONV));
    expect(result.current.menu).not.toBeNull();
    act(() => result.current.closeMenu());
    expect(result.current.menu).toBeNull();
  });
});

describe("useAnnotationEdit — page/data anchor toggle (MAIN #21)", () => {
  it("a data-anchored annotation's menu offers 'Pin to page', unchecked", () => {
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("a1", 0, 0, CONV));
    const pin = result.current.menu?.items.find(
      (i) => "label" in i && i.label.startsWith("Pin to"),
    ) as { label: string; checked?: boolean } | undefined;
    expect(pin?.label).toBe("Pin to page (stays on zoom)");
    expect(pin?.checked).toBe(false);
  });

  it("a page-anchored annotation's menu offers 'Pin to data', checked", () => {
    useApp.setState({ annotations: [{ id: "a1", x: 0.3, y: 0.4, text: "Tc", anchor: "page" }] });
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("a1", 0, 0, CONV));
    const pin = result.current.menu?.items.find(
      (i) => "label" in i && i.label.startsWith("Pin to"),
    ) as { label: string; checked?: boolean } | undefined;
    expect(pin?.label).toBe("Pin to data (follows zoom)");
    expect(pin?.checked).toBe(true);
  });

  it("toggling a data annotation to page adopts conv.toPage in place", () => {
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("a1", 0, 0, CONV));
    const pin = result.current.menu?.items.find((i) => "label" in i && i.label.startsWith("Pin to")) as {
      run: () => void;
    };
    act(() => pin.run());
    expect(useApp.getState().annotations[0]).toMatchObject({ anchor: "page", x: 0.4, y: 0.6 });
  });

  it("toggling a page annotation back to data adopts conv.toData in place", () => {
    useApp.setState({ annotations: [{ id: "a1", x: 0.3, y: 0.4, text: "Tc", anchor: "page" }] });
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("a1", 0, 0, CONV));
    const pin = result.current.menu?.items.find((i) => "label" in i && i.label.startsWith("Pin to")) as {
      run: () => void;
    };
    act(() => pin.run());
    expect(useApp.getState().annotations[0]).toMatchObject({ anchor: "data", x: 5, y: 9 });
  });
});

describe("useAnnotationEdit — Frame preset menu (MAIN #27 text box)", () => {
  function frameSubmenu(items: ContextMenuItem[]) {
    const frame = items.find((i) => "submenu" in i && i.label === "Frame") as
      | { submenu: { label: string; checked?: boolean; run?: () => void; disabled?: boolean; submenu?: unknown }[] }
      | undefined;
    return frame?.submenu ?? [];
  }

  it("an unframed annotation's Frame submenu shows None checked", () => {
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("a1", 0, 0, CONV));
    const sub = frameSubmenu(result.current.menu?.items ?? []);
    const none = sub.find((i) => i.label === "None");
    expect(none?.checked).toBe(true);
  });

  it("picking Subtle sets a low-opacity frame with no explicit fill/stroke", () => {
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("a1", 0, 0, CONV));
    const subtle = frameSubmenu(result.current.menu?.items ?? []).find((i) => i.label === "Subtle")!;
    act(() => subtle.run?.());
    expect(useApp.getState().annotations[0].frame).toEqual({ opacity: 0.15 });
  });

  it("picking Solid sets a concrete resolved fill + full opacity", () => {
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("a1", 0, 0, CONV));
    const solid = frameSubmenu(result.current.menu?.items ?? []).find((i) => i.label === "Solid")!;
    act(() => solid.run?.());
    const frame = useApp.getState().annotations[0].frame;
    expect(frame?.opacity).toBe(1);
    expect(typeof frame?.fill).toBe("string");
    expect(frame?.fill).not.toBe("");
  });

  it("picking None clears an existing frame", () => {
    useApp.setState({ annotations: [{ id: "a1", x: 1, y: 2, text: "Tc", frame: { opacity: 0.5 } }] });
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("a1", 0, 0, CONV));
    const none = frameSubmenu(result.current.menu?.items ?? []).find((i) => i.label === "None")!;
    act(() => none.run?.());
    expect(useApp.getState().annotations[0].frame).toBeUndefined();
  });

  it("the Opacity sub-submenu is disabled with no frame, enabled once framed", () => {
    const { result: r1 } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => r1.current.bridge?.onContextMenu?.("a1", 0, 0, CONV));
    const opacityDisabled = frameSubmenu(r1.current.menu?.items ?? []).find((i) => i.label === "Opacity") as {
      disabled?: boolean;
    };
    expect(opacityDisabled.disabled).toBe(true);

    useApp.setState({ annotations: [{ id: "a1", x: 1, y: 2, text: "Tc", frame: { opacity: 0.5 } }] });
    const { result: r2 } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => r2.current.bridge?.onContextMenu?.("a1", 0, 0, CONV));
    const opacityEnabled = frameSubmenu(r2.current.menu?.items ?? []).find((i) => i.label === "Opacity") as {
      disabled?: boolean;
    };
    expect(opacityEnabled.disabled).toBe(false);
  });

  it("picking an Opacity step patches opacity, preserving an existing fill (Solid then 50%)", () => {
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("a1", 0, 0, CONV));
    const solid = frameSubmenu(result.current.menu?.items ?? []).find((i) => i.label === "Solid")!;
    act(() => solid.run?.());
    const fill = useApp.getState().annotations[0].frame?.fill;

    act(() => result.current.bridge?.onContextMenu?.("a1", 0, 0, CONV));
    const opacitySub = frameSubmenu(result.current.menu?.items ?? []).find((i) => i.label === "Opacity") as {
      submenu: { label: string; run: () => void }[];
    };
    const fifty = opacitySub.submenu.find((i) => i.label === "50%")!;
    act(() => fifty.run());
    expect(useApp.getState().annotations[0].frame).toEqual({ fill, opacity: 0.5 });
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
