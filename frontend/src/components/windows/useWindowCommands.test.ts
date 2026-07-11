// Window commands v1 (MULTI_PLOT_PLAN item 5): published Action[] entries +
// the keyboard shortcuts that back them. The hook itself has no return value
// — it's tested purely through its side effects (the command registry +
// window.addEventListener("keydown")).

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { publishLivePlotSnapshot, type LivePlotSnapshot } from "../../lib/plotsnapshot";
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
  bg: "theme",
  linkGroup: null,
  pinned: false,
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
  publishLivePlotSnapshot(null); // never leak a seam bundle across tests
});

describe("useWindowCommands — published registry entries", () => {
  it("publishes exactly the 13 Window-group commands (item 17 adds the worksheet/map document-window pair) with the documented shortcuts", () => {
    renderHook(() => useWindowCommands());
    const ids = useCommands.getState().menuCommands.map((c) => c.id);
    expect(ids).toEqual([
      "window-new",
      "window-duplicate",
      "window-close",
      "window-snapshot",
      "window-worksheet",
      "window-map",
      "window-tile",
      "window-cascade",
      "window-bg-cycle",
      "window-link-cycle",
      "window-pin",
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

  it("'Open Worksheet in Window' (item 17) creates + raises a worksheet window on the ACTIVE dataset — focus stays on the plot window, stage switches to Plot", () => {
    useApp.setState({ stageTab: "worksheet" });
    renderHook(() => useWindowCommands());
    act(() => action("window-worksheet").run());
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(3);
    const doc = s.plotWindows.find((w) => !["w1", "w2"].includes(w.id))!;
    expect(doc.kind).toBe("worksheet");
    expect(doc.datasetId).toBe("d1");
    expect(doc.z).toBe(Math.max(...s.plotWindows.map((w) => w.z))); // raised on top
    expect(s.focusedWindowId).toBe("w1"); // document windows never take the view-facade focus
    expect(s.stageTab).toBe("plot"); // the window canvas only renders on the Plot tab
  });

  it("'Open Map in Window' (item 17) does the same with kind:'map'", () => {
    renderHook(() => useWindowCommands());
    act(() => action("window-map").run());
    const s = useApp.getState();
    const doc = s.plotWindows.find((w) => !["w1", "w2"].includes(w.id))!;
    expect(doc.kind).toBe("map");
    expect(doc.datasetId).toBe("d1");
    expect(s.focusedWindowId).toBe("w1");
  });

  it("both document-window commands are a no-op without an active dataset", () => {
    useApp.setState({ activeId: null });
    renderHook(() => useWindowCommands());
    act(() => action("window-worksheet").run());
    act(() => action("window-map").run());
    expect(useApp.getState().plotWindows).toHaveLength(2); // just w1/w2 — nothing created
  });

  it("Ctrl+Tab cycling skips document windows (item 17 — they can never hold focus)", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "ws1", kind: "worksheet" }), win({ id: "w2" })],
      focusedWindowId: "w1",
    });
    renderHook(() => useWindowCommands());
    act(() => press("Tab", { ctrl: true }));
    expect(useApp.getState().focusedWindowId).toBe("w2"); // straight past ws1
  });

  it("'Focus Next/Previous Window' matches v1's creation-order cycle for a SINGLE step when all z are equal", () => {
    // Chaining several steps would compound with focusWindow's own "raise
    // the target to the top z" side effect (unchanged since Tier 1) — that
    // interaction is covered by its own dedicated test below, and by the
    // "Ctrl+Tab...Ctrl+Shift+Tab" keyboard test. A single step from a
    // freshly-set, all-equal-z state stays identical to v1.
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "w2" }), win({ id: "w3" })],
      focusedWindowId: "w1",
    });
    renderHook(() => useWindowCommands());
    act(() => action("window-focus-next").run());
    expect(useApp.getState().focusedWindowId).toBe("w2");
  });

  it("'Focus Next/Previous Window' is Z-ORDER aware (item 6) — NOT creation order when z differs", () => {
    // Creation order is w1,w2,w3, but z-order (back-to-front) is w3,w1,w2.
    useApp.setState({
      plotWindows: [win({ id: "w1", z: 5 }), win({ id: "w2", z: 9 }), win({ id: "w3", z: 1 })],
      focusedWindowId: "w3", // lowest z — first in z-order
    });
    renderHook(() => useWindowCommands());
    act(() => action("window-focus-next").run());
    expect(useApp.getState().focusedWindowId).toBe("w1"); // next by z, not by creation order (which would be w2)
  });

  it("'Focus Previous Window' cycles backward by z-order, wrapping", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1", z: 5 }), win({ id: "w2", z: 9 }), win({ id: "w3", z: 1 })],
      focusedWindowId: "w3", // lowest z — first in z-order, so "previous" wraps to the last
    });
    renderHook(() => useWindowCommands());
    act(() => action("window-focus-prev").run());
    expect(useApp.getState().focusedWindowId).toBe("w2"); // highest z — last in z-order
  });

  it("'Tile Windows' / 'Cascade Windows' are published and re-lay-out the visible windows", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "w2" })],
      focusedWindowId: "w1",
      plotCanvasBounds: { width: 800, height: 400 },
    });
    renderHook(() => useWindowCommands());
    act(() => action("window-tile").run());
    const tiled = useApp.getState().plotWindows;
    expect(tiled.find((w) => w.id === "w1")!.geometry).not.toEqual(tiled.find((w) => w.id === "w2")!.geometry);

    act(() => action("window-cascade").run());
    const cascaded = useApp.getState().plotWindows;
    const w1 = cascaded.find((w) => w.id === "w1")!;
    const w2 = cascaded.find((w) => w.id === "w2")!;
    expect(w2.geometry.x).toBeGreaterThan(w1.geometry.x);
  });

  it("'Window Background' (item 18) cycles the FOCUSED window's bg, leaving other windows untouched", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1", bg: "theme" }), win({ id: "w2", bg: "theme" })],
      focusedWindowId: "w1",
    });
    renderHook(() => useWindowCommands());
    act(() => action("window-bg-cycle").run());
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")!.bg).toBe("light");
    expect(useApp.getState().plotWindows.find((w) => w.id === "w2")!.bg).toBe("theme");
    act(() => action("window-bg-cycle").run());
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")!.bg).toBe("dark");
  });

  it("'Window Background' is a no-op with no focused window", () => {
    useApp.setState({ plotWindows: [win({ id: "w1" })], focusedWindowId: null });
    renderHook(() => useWindowCommands());
    expect(() => act(() => action("window-bg-cycle").run())).not.toThrow();
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")!.bg).toBe("theme");
  });

  it("'Link Window Group' (item 13) cycles the FOCUSED window's link group, leaving other windows untouched", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "w2" })],
      focusedWindowId: "w1",
    });
    renderHook(() => useWindowCommands());
    act(() => action("window-link-cycle").run());
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")!.linkGroup).toBe(1);
    expect(useApp.getState().plotWindows.find((w) => w.id === "w2")!.linkGroup).toBeNull();
    act(() => action("window-link-cycle").run());
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")!.linkGroup).toBe(2);
  });

  it("'Link Window Group' is a no-op with no focused window", () => {
    useApp.setState({ plotWindows: [win({ id: "w1" })], focusedWindowId: null });
    renderHook(() => useWindowCommands());
    expect(() => act(() => action("window-link-cycle").run())).not.toThrow();
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")!.linkGroup).toBeNull();
  });

  it("'Pin Window' (item 14) toggles the FOCUSED window's pin — the no-title-bar (maximized) escape hatch", () => {
    renderHook(() => useWindowCommands());
    expect(action("window-pin").shortcut).toBeUndefined(); // menu/palette only, per the plan
    act(() => action("window-pin").run());
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")!.pinned).toBe(true);
    expect(useApp.getState().plotWindows.find((w) => w.id === "w2")!.pinned).toBe(false);
    act(() => action("window-pin").run());
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")!.pinned).toBe(false);
  });

  it("'Pin Window' is a no-op with no focused window", () => {
    useApp.setState({ plotWindows: [win({ id: "w1" })], focusedWindowId: null });
    renderHook(() => useWindowCommands());
    expect(() => act(() => action("window-pin").run())).not.toThrow();
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")!.pinned).toBe(false);
  });
});

describe("useWindowCommands — Snapshot to New Window (item 11)", () => {
  const liveBundle = (): LivePlotSnapshot => ({
    payload: {
      data: [
        [0, 1, 2],
        [10, 20, 30],
      ] as LivePlotSnapshot["payload"]["data"],
      series: [{ label: "m", unit: "emu" }],
      xLabel: "t",
      xUnit: "s",
    },
    styleList: undefined,
    labelList: undefined,
    errorBars: new Map(),
    plotted: [0],
    hidden: undefined,
  });

  it("freezes the seam's live bundle into a kind:'snapshot' window — WITHOUT moving focus", () => {
    const live = liveBundle();
    publishLivePlotSnapshot(live);
    renderHook(() => useWindowCommands());
    act(() => action("window-snapshot").run());
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(3);
    const snap = s.plotWindows.find((w) => !["w1", "w2"].includes(w.id))!;
    expect(snap.kind).toBe("snapshot");
    expect(snap.datasetId).toBeNull(); // never dataset-bound — frozen means frozen
    expect(snap.title.startsWith("Snapshot — ")).toBe(true);
    expect(s.focusedWindowId).toBe("w1"); // snapshots can never take focus
    // Deep copy, not a reference: the frozen data equals what was live but
    // shares no arrays with it.
    expect(snap.snapshot!.payload.data).toEqual(live.payload.data);
    expect(snap.snapshot!.payload.data[1]).not.toBe(live.payload.data[1]);
  });

  it("is a no-op while no live payload is published (empty plot / alt mode / other tab)", () => {
    publishLivePlotSnapshot(null);
    renderHook(() => useWindowCommands());
    act(() => action("window-snapshot").run());
    expect(useApp.getState().plotWindows).toHaveLength(2);
  });

  it("focus cycling skips snapshot windows", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "w2", kind: "snapshot" }), win({ id: "w3" })],
      focusedWindowId: "w1",
    });
    renderHook(() => useWindowCommands());
    act(() => action("window-focus-next").run());
    // Creation/z order would say w2 next — but w2 is a snapshot, so the
    // cycle lands on w3.
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
    // Each Tab press is a committed `focusWindow` call, which (unchanged
    // since Tier 1) also RAISES the target to the top z — so cycling
    // backward from here is z-order-aware (item 6) over a stack w2 just
    // reshuffled, not a plain reversal back to "w1". With w2 now on top,
    // the back-to-front order is w1,w3,w2 — one step back from w2 is w3.
    act(() => press("Tab", { ctrl: true, shift: true }));
    expect(useApp.getState().focusedWindowId).toBe("w3");

    // Cmd+Tab (macOS app switcher) must never be hijacked — Meta alone isn't
    // Ctrl, so this is a deliberate no-op.
    act(() => press("Tab", { meta: true }));
    expect(useApp.getState().focusedWindowId).toBe("w3");
  });

  it("removes its keydown listener on unmount", () => {
    const { unmount } = renderHook(() => useWindowCommands());
    unmount();
    act(() => press("n", { meta: true, shift: true }));
    expect(useApp.getState().plotWindows).toHaveLength(2); // no new window — listener is gone
  });
});
