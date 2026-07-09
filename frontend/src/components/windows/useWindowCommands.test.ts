// Window commands v1 (MULTI_PLOT_PLAN item 5): published Action[] entries +
// the keyboard shortcuts that back them. The hook itself has no return value
// — it's tested purely through its side effects (the command registry +
// window.addEventListener("keydown")).

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import { useCommands } from "../../store/commands";
import { useApp } from "../../store/useApp";
import { useWindowCommands } from "./useWindowCommands";

const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
  id: "w1",
  kind: "plot",
  title: "",
  datasetId: "d1",
  geometry: { x: 0, y: 0, w: 480, h: 360 },
  z: 0,
  winState: "normal",
  view: defaultPlotView(),
  ...over,
});

function action(id: string) {
  const a = useCommands.getState().menuCommands.find((c) => c.id === id);
  if (!a) throw new Error(`no published action ${id}`);
  return a;
}

function press(key: string, opts: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}) {
  const e = new KeyboardEvent("keydown", {
    key,
    ctrlKey: !!opts.ctrl,
    metaKey: !!opts.meta,
    shiftKey: !!opts.shift,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(e);
}

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "d1", name: "a", data: { time: [1], values: [[1]], labels: ["m"], units: [""], metadata: {} } }],
    activeId: "d1",
    plotWindows: [win({ id: "w1" }), win({ id: "w2" })],
    focusedWindowId: "w1",
  });
  useCommands.setState({ menuCommands: [] });
});
afterEach(() => {
  useCommands.setState({ menuCommands: [] });
  useApp.setState({ plotWindows: [win({ id: "w1", winState: "maximized" })], focusedWindowId: "w1" });
});

describe("useWindowCommands — published registry entries", () => {
  it("publishes exactly the 5 Window-group commands with the documented shortcuts", () => {
    renderHook(() => useWindowCommands());
    const ids = useCommands.getState().menuCommands.map((c) => c.id);
    expect(ids).toEqual([
      "window-new",
      "window-duplicate",
      "window-close",
      "window-focus-next",
      "window-focus-prev",
    ]);
    expect(useCommands.getState().menuCommands.every((c) => c.group === "Window")).toBe(true);
    expect(action("window-new").shortcut).toBe("⌘⇧N");
    expect(action("window-close").shortcut).toBe("⌘⇧W");
  });

  it("'New Graph Window' creates + focuses a new window bound to the active dataset", () => {
    renderHook(() => useWindowCommands());
    act(() => action("window-new").run());
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(3);
    const created = s.plotWindows.find((w) => !["w1", "w2"].includes(w.id))!;
    expect(created.datasetId).toBe("d1");
    expect(s.focusedWindowId).toBe(created.id);
  });

  it("'Duplicate Window' clones the FOCUSED window and focuses the copy", () => {
    renderHook(() => useWindowCommands());
    act(() => action("window-duplicate").run());
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(3);
    const dup = s.plotWindows.find((w) => !["w1", "w2"].includes(w.id))!;
    expect(dup.datasetId).toBe("d1");
    expect(s.focusedWindowId).toBe(dup.id);
  });

  it("'Close Window' closes the focused window and refocuses a survivor", () => {
    renderHook(() => useWindowCommands());
    act(() => action("window-close").run());
    const s = useApp.getState();
    expect(s.plotWindows.map((w) => w.id)).toEqual(["w2"]);
    expect(s.focusedWindowId).toBe("w2");
  });

  it("'Close Window' is a no-op on the last surviving window (the ≥1-window invariant)", () => {
    useApp.setState({ plotWindows: [win({ id: "w1" })], focusedWindowId: "w1" });
    renderHook(() => useWindowCommands());
    act(() => action("window-close").run());
    expect(useApp.getState().plotWindows).toHaveLength(1);
  });

  it("'Focus Next/Previous Window' cycle by creation order, wrapping", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "w2" }), win({ id: "w3" })],
      focusedWindowId: "w1",
    });
    renderHook(() => useWindowCommands());
    act(() => action("window-focus-next").run());
    expect(useApp.getState().focusedWindowId).toBe("w2");
    act(() => action("window-focus-prev").run());
    expect(useApp.getState().focusedWindowId).toBe("w1");
    act(() => action("window-focus-prev").run()); // wraps backward
    expect(useApp.getState().focusedWindowId).toBe("w3");
  });
});

describe("useWindowCommands — keyboard shortcuts", () => {
  it("⌘⇧N / Ctrl+⇧N triggers New Graph Window", () => {
    renderHook(() => useWindowCommands());
    act(() => press("n", { meta: true, shift: true }));
    expect(useApp.getState().plotWindows).toHaveLength(3);
  });

  it("⌘⇧W triggers Close Window", () => {
    renderHook(() => useWindowCommands());
    act(() => press("w", { ctrl: true, shift: true }));
    expect(useApp.getState().plotWindows.map((w) => w.id)).toEqual(["w2"]);
  });

  it("Ctrl+Tab cycles focus forward; Ctrl+Shift+Tab cycles backward — Cmd+Tab is untouched", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "w2" }), win({ id: "w3" })],
      focusedWindowId: "w1",
    });
    renderHook(() => useWindowCommands());
    act(() => press("Tab", { ctrl: true }));
    expect(useApp.getState().focusedWindowId).toBe("w2");
    act(() => press("Tab", { ctrl: true, shift: true }));
    expect(useApp.getState().focusedWindowId).toBe("w1");

    // Cmd+Tab (macOS app switcher) must never be hijacked — Meta alone isn't
    // Ctrl, so this is a deliberate no-op.
    act(() => press("Tab", { meta: true }));
    expect(useApp.getState().focusedWindowId).toBe("w1");
  });

  it("removes its keydown listener on unmount", () => {
    const { unmount } = renderHook(() => useWindowCommands());
    unmount();
    act(() => press("n", { meta: true, shift: true }));
    expect(useApp.getState().plotWindows).toHaveLength(2); // no new window — listener is gone
  });
});
