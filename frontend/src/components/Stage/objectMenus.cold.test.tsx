// The object menus' COLD path (bundle diet slice 30, plans/BUNDLE_HEADROOM.md):
// gestures that arrive while `./objectMenus` is still loading, or after its
// load failed. Each test gets a fresh module graph (`vi.resetModules`), so the
// loader starts unloaded, and the chunk is held behind a gate this file
// controls (or fails), so the race is forced rather than hoped for
// (docs/testing.md).
import { render, renderHook } from "@testing-library/react";
import { act, createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../store/annotationTextDialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../store/annotationTextDialog")>()),
  askAnnotationText: vi.fn(),
}));

/** How the next `import("./objectMenus")` behaves, and how many were made. */
const chunk = {
  mode: "gate" as "gate" | "fail",
  calls: 0,
  gate: Promise.resolve(),
  release: () => {},
};
function holdChunk(): void {
  chunk.gate = new Promise<void>((resolve) => {
    chunk.release = resolve;
  });
}

const CONV = { toPage: { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 }, toData: { x1: 5, y1: 6, x2: 7, y2: 8 } };
const ANN_CONV = { toPage: { x: 0.1, y: 0.2 }, toData: { x: 1, y: 2 } };

async function fresh() {
  vi.resetModules();
  vi.doMock("./objectMenus", async () => {
    chunk.calls += 1;
    if (chunk.mode === "fail") throw new Error("network error");
    await chunk.gate;
    return vi.importActual<typeof import("./objectMenus")>("./objectMenus");
  });
  const { useApp } = await import("../../store/useApp");
  const { useToasts } = await import("../../store/toasts");
  const { askAnnotationText } = await import("../../store/annotationTextDialog");
  const loader = await import("./objectMenusLoader");
  const { useAnnotationEdit } = await import("./useAnnotationEdit");
  const { useShapeEdit } = await import("./useShapeEdit");
  const { useShapeDraw } = await import("./useShapeDraw");
  const { default: SelectionMiniToolbar } = await import("./SelectionMiniToolbar");
  useToasts.setState({ toasts: [] });
  useApp.setState({
    plotTool: "pointer",
    drawShapeKind: null,
    shapes: [
      { id: "s1", kind: "rect", x1: 1, y1: 2, x2: 3, y2: 4 },
      { id: "s2", kind: "ellipse", x1: 1, y1: 2, x2: 3, y2: 4 },
    ],
    selectedShapeId: null,
    annotations: [
      { id: "a1", x: 1, y: 2, text: "Tc" },
      { id: "a2", x: 3, y: 4, text: "Hc" },
    ],
    selectedAnnotationId: null,
  });
  const ask = vi.mocked(askAnnotationText);
  ask.mockReset();
  ask.mockResolvedValue(null);
  const dangerToasts = () => useToasts.getState().toasts.filter((t) => t.kind === "danger").map((t) => t.msg);
  /** Let the chunk land and every gesture queued on it settle. */
  const land = async () => {
    chunk.release();
    await act(async () => {
      await loader.loadObjectMenus().catch(() => {});
    });
  };
  return { useApp, loader, ask, dangerToasts, land, useAnnotationEdit, useShapeEdit, useShapeDraw, SelectionMiniToolbar };
}

beforeEach(() => {
  chunk.mode = "gate";
  chunk.calls = 0;
  holdChunk();
});

describe("object menus, cold: no objects, no fetch", () => {
  it("a plot with no annotations, shapes, armed text box or selection never requests the chunk", async () => {
    const t = await fresh();
    t.useApp.setState({ annotations: [], shapes: [] });
    renderHook(() => t.useAnnotationEdit("pointer"));
    renderHook(() => t.useShapeEdit("pointer"));
    renderHook(() => t.useShapeDraw());
    render(createElement(t.SelectionMiniToolbar));
    await act(async () => {
      await Promise.resolve();
    });
    expect(chunk.calls).toBe(0);
    expect(t.loader.objectMenus()).toBeNull();

    // Positive control: the first annotation starts the warm-up.
    act(() => {
      t.useApp.getState().addAnnotation(1, 2, "Tc");
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(chunk.calls).toBe(1);
  });
});

describe("object menus, cold: a gesture queued on the load", () => {
  it("a right-click opens its menu once the chunk lands", async () => {
    const t = await fresh();
    const { result } = renderHook(() => t.useShapeEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("s1", 40, 60, CONV));
    expect(result.current.menu).toBeNull();
    await t.land();
    expect(result.current.menu).toMatchObject({ x: 40, y: 60 });
  });

  it("only the newest queued gesture runs", async () => {
    const t = await fresh();
    const { result } = renderHook(() => t.useShapeEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("s1", 1, 1, CONV));
    act(() => result.current.bridge?.onContextMenu?.("s2", 2, 2, CONV));
    await t.land();
    expect(result.current.menu).toMatchObject({ x: 2, y: 2 });
    expect(result.current.menu?.items[0]).toEqual({ header: "Ellipse" });
  });

  it.each([
    ["a pointerdown anywhere", () => window.dispatchEvent(new Event("pointerdown"))],
    ["Escape", () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))],
  ])("drops the queued menu after %s, and the next right-click opens at once", async (_what, moveOn) => {
    const t = await fresh();
    const { result } = renderHook(() => t.useShapeEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("s1", 40, 60, CONV));
    act(() => {
      moveOn();
    });
    await t.land();
    expect(result.current.menu).toBeNull();

    act(() => result.current.bridge?.onContextMenu?.("s1", 7, 8, CONV));
    expect(result.current.menu).toMatchObject({ x: 7, y: 8 });
  });

  it("closeMenu drops a queued annotation menu", async () => {
    const t = await fresh();
    const { result } = renderHook(() => t.useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onContextMenu?.("a1", 10, 20, ANN_CONV));
    act(() => result.current.closeMenu());
    await t.land();
    expect(result.current.menu).toBeNull();
  });

  it("leaving the pointer tool drops a queued menu", async () => {
    const t = await fresh();
    const { result, rerender } = renderHook(({ tool }) => t.useShapeEdit(tool), { initialProps: { tool: "pointer" } });
    const bridge = result.current.bridge;
    act(() => bridge?.onContextMenu?.("s1", 40, 60, CONV));
    rerender({ tool: "zoom" });
    await t.land();
    expect(result.current.menu).toBeNull();
  });

  it("a label double-click opens the text editor once the chunk lands", async () => {
    const t = await fresh();
    const { result } = renderHook(() => t.useAnnotationEdit("pointer"));
    act(() => result.current.bridge?.onEditText?.("a1"));
    expect(t.ask).not.toHaveBeenCalled();
    await t.land();
    expect(t.ask).toHaveBeenCalledWith("Edit annotation text", "Tc");
  });

  it("a placed text box opens its dialog once the chunk lands, though the commit flipped the tool", async () => {
    const t = await fresh();
    t.useApp.setState({ drawShapeKind: "textbox", plotTool: "zoom" });
    const { result } = renderHook(() => t.useShapeDraw());
    act(() => result.current.shapeDraw?.onDrawCommit?.("textbox", 5, 6, 5, 6));
    expect(t.useApp.getState().plotTool).toBe("pointer");
    expect(t.ask).not.toHaveBeenCalled();
    await t.land();
    expect(t.ask).toHaveBeenCalledWith("Text box", "");
  });
});

describe("object menus, cold: the chunk will not load", () => {
  it("a placed text box reports it and creates nothing", async () => {
    chunk.mode = "fail";
    const t = await fresh();
    t.useApp.setState({ drawShapeKind: "textbox", annotations: [] });
    const { result } = renderHook(() => t.useShapeDraw());
    act(() => result.current.shapeDraw?.onDrawCommit?.("textbox", 5, 6, 5, 6));
    await vi.waitFor(() => expect(t.dangerToasts()).toHaveLength(1));
    expect(t.dangerToasts()[0]).toMatch(/^Could not load the object menu: .+Try again\.$/);
    expect(t.ask).not.toHaveBeenCalled();
    expect(t.useApp.getState().annotations).toEqual([]);
    expect(t.useApp.getState().drawShapeKind).toBeNull();
  });

  it("the mini-toolbar shows its strip after a failed load once a new selection loads it", async () => {
    chunk.mode = "fail";
    const t = await fresh();
    t.useApp.setState({ selectedAnnotationId: "a1" });
    const view = render(createElement(t.SelectionMiniToolbar));
    await act(async () => {
      await t.loader.loadObjectMenus().catch(() => {});
    });
    expect(view.container.querySelector(".qzk-mini-toolbar")).toBeNull();

    chunk.mode = "gate";
    chunk.release();
    act(() => t.useApp.setState({ selectedAnnotationId: "a2" })); // stays selected: a new key, not a clear
    expect(await view.findByText("Edit text…")).toBeTruthy();
  });

  it("the mini-toolbar shows its strip after a failed load once any other caller loads it", async () => {
    chunk.mode = "fail";
    const t = await fresh();
    t.useApp.setState({ selectedShapeId: "s1" });
    const view = render(createElement(t.SelectionMiniToolbar));
    await act(async () => {
      await t.loader.loadObjectMenus().catch(() => {});
    });
    expect(view.container.querySelector(".qzk-mini-toolbar")).toBeNull();

    chunk.mode = "gate";
    chunk.release();
    await act(async () => {
      await t.loader.loadObjectMenus(); // e.g. a right-click elsewhere
    });
    expect(view.getByText("Dashed")).toBeTruthy();
  });
});
