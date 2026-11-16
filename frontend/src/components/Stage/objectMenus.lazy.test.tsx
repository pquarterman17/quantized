// The object menus load on demand (bundle diet slice 30,
// plans/BUNDLE_HEADROOM.md): the COLD path, which the hook suites skip by
// loading the module up front. Its own file because `vi.doMock` must be
// registered before the module's first load, and because the loader keeps
// the loaded module for the rest of the file.
import { render, renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useApp } from "../../store/useApp";
import { useToasts } from "../../store/toasts";
import SelectionMiniToolbar from "./SelectionMiniToolbar";
import { objectMenus } from "./objectMenusLoader";
import { useAnnotationEdit } from "./useAnnotationEdit";
import { useShapeEdit } from "./useShapeEdit";

const CONV = {
  toPage: { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 },
  toData: { x1: 5, y1: 6, x2: 7, y2: 8 },
};
const ANN_CONV = { toPage: { x: 0.1, y: 0.2 }, toData: { x: 1, y: 2 } };

const dangerToasts = () => useToasts.getState().toasts.filter((t) => t.kind === "danger").map((t) => t.msg);

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useApp.setState({
    plotTool: "pointer",
    shapes: [{ id: "s1", kind: "rect", x1: 1, y1: 2, x2: 3, y2: 4 }],
    selectedShapeId: null,
    annotations: [{ id: "a1", x: 1, y: 2, text: "Tc" }],
    selectedAnnotationId: null,
  });
});

afterEach(() => {
  vi.doUnmock("./objectMenus");
});

// Order matters: the failure runs first, while nothing is loaded yet.
describe("object menus: the chunk will not load", () => {
  it("a right-click reports it and opens no menu; nothing is cached, so a later right-click retries", async () => {
    vi.doMock("./objectMenus", () => {
      throw new Error("network error");
    });
    const { result } = renderHook(() => useShapeEdit("pointer"));

    act(() => result.current.bridge?.onContextMenu?.("s1", 40, 60, CONV));

    await waitFor(() => expect(dangerToasts()).toHaveLength(1));
    expect(dangerToasts()[0]).toMatch(/^Could not load the object menu: .+Try again\.$/);
    expect(result.current.menu).toBeNull();
    expect(objectMenus()).toBeNull();

    vi.doUnmock("./objectMenus");
    act(() => result.current.bridge?.onContextMenu?.("s1", 40, 60, CONV));
    await waitFor(() => expect(result.current.menu).toMatchObject({ x: 40, y: 60 }));
    expect(objectMenus()).not.toBeNull();
  });
});

describe("object menus: loaded on demand", () => {
  it("an annotation right-click opens the same menu once the module has loaded", async () => {
    const { result } = renderHook(() => useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("a1", 10, 20, ANN_CONV));
    await waitFor(() => expect(result.current.menu).toMatchObject({ x: 10, y: 20 }));
    const labels = result.current.menu?.items.map((i) => ("label" in i ? i.label : undefined));
    expect(labels).toContain("Frame");
    expect(labels).toContain("Delete");
  });

  it("the selection mini-toolbar shows the strip for a selected shape", async () => {
    useApp.setState({ selectedShapeId: "s1" });
    const { findByText } = render(<SelectionMiniToolbar />);
    expect(await findByText("Dashed")).toBeTruthy();
  });
});
