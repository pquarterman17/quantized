// useShapeEdit — the MAIN #27 pointer-mode SHAPE bridge + object-menu hook.
// Same renderHook/act convention as useAnnotationEdit.test.ts.

import { fireEvent, renderHook } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type { ContextMenuItem } from "../overlays/ContextMenu";
import { useApp } from "../../store/useApp";
import { useShapeEdit } from "./useShapeEdit";

// A stand-in conv (mirrors useAnnotationEdit.test.ts's CONV) — the plugin's
// own shapeAnchorConversions round-trip lives in uplotShapes.test.ts; this
// file only needs a concrete value to feed the pin toggle action.
const CONV = {
  toPage: { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 },
  toData: { x1: 5, y1: 6, x2: 7, y2: 8 },
};

beforeEach(() => {
  useApp.setState({
    shapes: [{ id: "s1", kind: "rect", x1: 1, y1: 2, x2: 3, y2: 4 }],
    selectedShapeId: null,
  });
});

function menuItems(result: { current: { menu: { items: ContextMenuItem[] } | null } }) {
  return result.current.menu?.items ?? [];
}

describe("useShapeEdit — bridge gating", () => {
  it("is null outside pointer mode", () => {
    const { result } = renderHook(() => useShapeEdit("zoom"));
    expect(result.current.bridge).toBeNull();
  });

  it("is null in pointer mode with no shapes", () => {
    useApp.setState({ shapes: [] });
    const { result } = renderHook(() => useShapeEdit("pointer"));
    expect(result.current.bridge).toBeNull();
  });

  it("is a bridge carrying the current selection in pointer mode with shapes present", () => {
    useApp.setState({ selectedShapeId: "s1" });
    const { result } = renderHook(() => useShapeEdit("pointer"));
    expect(result.current.bridge?.selectedId).toBe("s1");
  });
});

describe("useShapeEdit — bridge callbacks", () => {
  it("onSelect updates the store's selectedShapeId", () => {
    const { result } = renderHook(() => useShapeEdit("pointer"));
    act(() => result.current.bridge?.onSelect?.("s1"));
    expect(useApp.getState().selectedShapeId).toBe("s1");
  });

  it("onMove commits all four endpoint coords via updateShape", () => {
    const { result } = renderHook(() => useShapeEdit("pointer"));
    act(() => result.current.bridge?.onMove?.("s1", 10, 20, 30, 40));
    expect(useApp.getState().shapes[0]).toMatchObject({ x1: 10, y1: 20, x2: 30, y2: 40 });
  });

  it("onReshape patches only the given fields", () => {
    const { result } = renderHook(() => useShapeEdit("pointer"));
    act(() => result.current.bridge?.onReshape?.("s1", { x1: 99 }));
    expect(useApp.getState().shapes[0]).toMatchObject({ x1: 99, y1: 2, x2: 3, y2: 4 });
  });
});

describe("useShapeEdit — object menu (right-click)", () => {
  it("opens a menu with Stroke/Opacity/Width/Dashed/Pin/Delete", () => {
    const { result } = renderHook(() => useShapeEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("s1", 40, 60, CONV));
    expect(result.current.menu).toMatchObject({ x: 40, y: 60 });
    const labels = menuItems(result).map((i) => ("label" in i ? i.label : undefined));
    expect(labels).toEqual(
      expect.arrayContaining(["Opacity", "Width", "Dashed", "Pin to page (stays on zoom)", "Delete"]),
    );
  });

  it("shows a Fill swatch row for rect/ellipse but not for line/arrow", () => {
    const { result: rectResult } = renderHook(() => useShapeEdit("pointer"));
    act(() => rectResult.current.bridge?.onContextMenu?.("s1", 0, 0, CONV));
    expect(menuItems(rectResult).some((i) => "header" in i && i.header === "Fill")).toBe(true);

    useApp.setState({ shapes: [{ id: "s2", kind: "arrow", x1: 0, y1: 0, x2: 1, y2: 1 }] });
    const { result: arrowResult } = renderHook(() => useShapeEdit("pointer"));
    act(() => arrowResult.current.bridge?.onContextMenu?.("s2", 0, 0, CONV));
    expect(menuItems(arrowResult).some((i) => "header" in i && i.header === "Fill")).toBe(false);
  });

  it("a stroke swatch click sets the stroke override", () => {
    const { result } = renderHook(() => useShapeEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("s1", 0, 0, CONV));
    const strokeRow = menuItems(result).find((i) => "swatches" in i) as {
      swatches: { key: string; run: () => void }[];
    };
    const first = strokeRow.swatches.find((s) => s.key === "--series-1")!;
    act(() => first.run());
    expect(useApp.getState().shapes[0].stroke).toBe("--series-1");
  });

  it("the Width submenu sets a discrete px value", () => {
    const { result } = renderHook(() => useShapeEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("s1", 0, 0, CONV));
    const width = menuItems(result).find((i) => "submenu" in i && i.label === "Width") as {
      submenu: { label: string; run: () => void }[];
    };
    const three = width.submenu.find((w) => w.label === "3 px")!;
    act(() => three.run());
    expect(useApp.getState().shapes[0].width).toBe(3);
  });

  it("the Opacity submenu sets a preset fraction", () => {
    const { result } = renderHook(() => useShapeEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("s1", 0, 0, CONV));
    const opacity = menuItems(result).find((i) => "submenu" in i && i.label === "Opacity") as {
      submenu: { label: string; run: () => void }[];
    };
    const half = opacity.submenu.find((o) => o.label === "50%")!;
    act(() => half.run());
    expect(useApp.getState().shapes[0].opacity).toBe(0.5);
  });

  it("Dashed toggles the dash flag", () => {
    const { result } = renderHook(() => useShapeEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("s1", 0, 0, CONV));
    const dashed = menuItems(result).find((i) => "label" in i && i.label === "Dashed") as { run: () => void };
    act(() => dashed.run());
    expect(useApp.getState().shapes[0].dash).toBe(true);
  });

  it("Delete removes the shape and clears the selection", () => {
    useApp.setState({ selectedShapeId: "s1" });
    const { result } = renderHook(() => useShapeEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("s1", 0, 0, CONV));
    const del = menuItems(result).find((i) => "label" in i && i.label === "Delete") as { run: () => void };
    act(() => del.run());
    expect(useApp.getState().shapes).toEqual([]);
    expect(useApp.getState().selectedShapeId).toBeNull();
  });

  it("closeMenu clears the menu state", () => {
    const { result } = renderHook(() => useShapeEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("s1", 0, 0, CONV));
    expect(result.current.menu).not.toBeNull();
    act(() => result.current.closeMenu());
    expect(result.current.menu).toBeNull();
  });
});

describe("useShapeEdit — page/data anchor toggle (MAIN #27)", () => {
  it("a data-anchored shape's menu offers 'Pin to page', unchecked", () => {
    const { result } = renderHook(() => useShapeEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("s1", 0, 0, CONV));
    const pin = menuItems(result).find((i) => "label" in i && i.label.startsWith("Pin to")) as {
      label: string;
      checked?: boolean;
    };
    expect(pin.label).toBe("Pin to page (stays on zoom)");
    expect(pin.checked).toBe(false);
  });

  it("toggling to page adopts conv.toPage's four coords in place", () => {
    const { result } = renderHook(() => useShapeEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("s1", 0, 0, CONV));
    const pin = menuItems(result).find((i) => "label" in i && i.label.startsWith("Pin to")) as { run: () => void };
    act(() => pin.run());
    expect(useApp.getState().shapes[0]).toMatchObject({ anchor: "page", ...CONV.toPage });
  });

  it("a page-anchored shape's menu offers 'Pin to data', checked, and toggles back via conv.toData", () => {
    useApp.setState({ shapes: [{ id: "s1", kind: "rect", x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4, anchor: "page" }] });
    const { result } = renderHook(() => useShapeEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("s1", 0, 0, CONV));
    const pin = menuItems(result).find((i) => "label" in i && i.label.startsWith("Pin to")) as {
      label: string;
      checked?: boolean;
      run: () => void;
    };
    expect(pin.label).toBe("Pin to data (follows zoom)");
    expect(pin.checked).toBe(true);
    act(() => pin.run());
    expect(useApp.getState().shapes[0]).toMatchObject({ anchor: "data", ...CONV.toData });
  });
});

describe("useShapeEdit — Escape deselects", () => {
  it("clears selectedShapeId on Escape while something is selected", () => {
    useApp.setState({ selectedShapeId: "s1" });
    renderHook(() => useShapeEdit("pointer"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().selectedShapeId).toBeNull();
  });

  it("is a no-op when nothing is selected", () => {
    renderHook(() => useShapeEdit("pointer"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().selectedShapeId).toBeNull();
  });
});
