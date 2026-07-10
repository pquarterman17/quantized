// PlotWindowFrame owns geometry drag/resize (through the real store actions),
// close, and the "any pointerdown on an unfocused frame focuses it" contract
// (item 3/4). Drag/resize are rAF-throttled; jsdom's requestAnimationFrame
// never actually fires (no paint loop to synchronize with), so it's stubbed
// to invoke its callback synchronously — the store update then lands within
// the same `fireEvent`-wrapped `act()` and can be asserted immediately.

import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import { useApp } from "../../store/useApp";
import { DATASET_DND } from "../Library/useLibraryTree";
import PlotWindowFrame from "./PlotWindowFrame";

const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
  id: "w1",
  kind: "plot",
  title: "",
  datasetId: null,
  geometry: { x: 100, y: 80, w: 480, h: 360 },
  z: 0,
  winState: "normal",
  view: defaultPlotView(),
  bg: "theme",
  linkGroup: null,
  pinned: false,
  ...over,
});

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  useApp.setState({ plotWindows: [win({ id: "w1" }), win({ id: "w2" })], focusedWindowId: "w1" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useApp.setState({ plotWindows: [win({ id: "w1" })], focusedWindowId: "w1" });
});

const geomOf = (id: string) => useApp.getState().plotWindows.find((w) => w.id === id)!.geometry;

describe("PlotWindowFrame", () => {
  it("dragging the title bar moves the window (rAF-flushed into the store)", async () => {
    const { container } = render(
      <PlotWindowFrame win={win({ id: "w1" })} focused datasetName="ds1">
        <div>content</div>
      </PlotWindowFrame>,
    );
    const titlebar = container.querySelector(".qzk-plotwin-titlebar")!;
    fireEvent.pointerDown(titlebar, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 140, clientY: 130 });
    fireEvent.pointerUp(window, { clientX: 140, clientY: 130 });
    await waitFor(() => expect(geomOf("w1")).toEqual({ x: 140, y: 110, w: 480, h: 360 }));
  });

  it("dragging the resize grip resizes the window, clamped to a minimum size", async () => {
    const { container } = render(
      <PlotWindowFrame win={win({ id: "w1" })} focused datasetName="ds1">
        <div>content</div>
      </PlotWindowFrame>,
    );
    const grip = container.querySelector(".qzk-plotwin-resize")!;
    fireEvent.pointerDown(grip, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 40 });
    fireEvent.pointerUp(window, { clientX: 60, clientY: 40 });
    await waitFor(() => expect(geomOf("w1")).toEqual({ x: 100, y: 80, w: 540, h: 400 }));

    // A big negative drag clamps to the minimum size, never collapses to zero.
    // (win's geometry PROP is a fixed snapshot from this test's one render, so
    // this second gesture's origin is still the pre-drag 480×360 — the store
    // itself already holds 540×400 from the first gesture above.)
    fireEvent.pointerDown(grip, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(window, { clientX: -10000, clientY: -10000 });
    await waitFor(() => {
      const g = geomOf("w1");
      expect(g.w).toBeGreaterThanOrEqual(1);
      expect(g.h).toBeGreaterThanOrEqual(1);
      expect(g.w).toBeLessThan(300); // clamped to MIN_W, not left at the pre-drag 540
    });
  });

  it("no resize grip renders for a maximized window", () => {
    const { container } = render(
      <PlotWindowFrame win={win({ id: "w1", winState: "maximized" })} focused datasetName="ds1">
        <div>content</div>
      </PlotWindowFrame>,
    );
    expect(container.querySelector(".qzk-plotwin-resize")).toBeNull();
  });

  it("the close button closes the window via the store", () => {
    const { getByLabelText } = render(
      <PlotWindowFrame win={win({ id: "w2" })} focused={false} datasetName={undefined}>
        <div>content</div>
      </PlotWindowFrame>,
    );
    fireEvent.click(getByLabelText("Close window"));
    expect(useApp.getState().plotWindows.map((w) => w.id)).toEqual(["w1"]);
  });

  it("the ◐ background button cycles this window's bg (theme -> light -> dark) via the store (item 18)", () => {
    const { getByLabelText } = render(
      <PlotWindowFrame win={win({ id: "w1", bg: "theme" })} focused datasetName="ds1">
        <div>content</div>
      </PlotWindowFrame>,
    );
    const button = getByLabelText("Cycle window background");
    fireEvent.click(button);
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")?.bg).toBe("light");
  });

  it("the ⧟ link button cycles this window's link group (off -> 1 -> 2 -> 3 -> off) via the store (item 13)", () => {
    const { getByLabelText } = render(
      <PlotWindowFrame win={win({ id: "w1" })} focused datasetName="ds1">
        <div>content</div>
      </PlotWindowFrame>,
    );
    fireEvent.click(getByLabelText("Cycle window link group"));
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")?.linkGroup).toBe(1);
    // Other windows are untouched — linking is strictly per-window opt-in.
    expect(useApp.getState().plotWindows.find((w) => w.id === "w2")?.linkGroup).toBeNull();
  });

  it("the link button shows the current group digit while linked (and no digit when off)", () => {
    const unlinked = render(
      <PlotWindowFrame win={win({ id: "w1", linkGroup: null })} focused datasetName="ds1">
        <div>content</div>
      </PlotWindowFrame>,
    );
    expect(unlinked.container.querySelector(".qzk-plotwin-link-n")).toBeNull();
    expect(unlinked.container.querySelector(".qzk-plotwin-link.linked")).toBeNull();
    unlinked.unmount();

    const linked = render(
      <PlotWindowFrame win={win({ id: "w1", linkGroup: 2 })} focused datasetName="ds1">
        <div>content</div>
      </PlotWindowFrame>,
    );
    expect(linked.container.querySelector(".qzk-plotwin-link-n")?.textContent).toBe("2");
    expect(linked.container.querySelector(".qzk-plotwin-link.linked")).not.toBeNull();
  });

  it("clicking the link button does not also start a title-bar drag", () => {
    const { getByLabelText } = render(
      <PlotWindowFrame win={win({ id: "w1" })} focused datasetName="ds1">
        <div>content</div>
      </PlotWindowFrame>,
    );
    const before = geomOf("w1");
    fireEvent.pointerDown(getByLabelText("Cycle window link group"), { clientX: 5, clientY: 5, button: 0 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 50 });
    fireEvent.pointerUp(window, { clientX: 50, clientY: 50 });
    expect(geomOf("w1")).toEqual(before);
  });

  it("clicking the background button does not also start a title-bar drag", () => {
    const { getByLabelText } = render(
      <PlotWindowFrame win={win({ id: "w1", bg: "theme" })} focused datasetName="ds1">
        <div>content</div>
      </PlotWindowFrame>,
    );
    const before = geomOf("w1");
    fireEvent.pointerDown(getByLabelText("Cycle window background"), { clientX: 5, clientY: 5, button: 0 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 50 });
    fireEvent.pointerUp(window, { clientX: 50, clientY: 50 });
    expect(geomOf("w1")).toEqual(before);
  });

  it("any pointerdown on an UNFOCUSED frame focuses it first (capture phase)", () => {
    const { container } = render(
      <PlotWindowFrame win={win({ id: "w2" })} focused={false} datasetName={undefined}>
        <div className="probe">content</div>
      </PlotWindowFrame>,
    );
    fireEvent.pointerDown(container.querySelector(".probe")!, { clientX: 5, clientY: 5, button: 0 });
    expect(useApp.getState().focusedWindowId).toBe("w2");
  });

  it("a pointerdown on an already-FOCUSED frame is a no-op (no redundant focusWindow call)", () => {
    render(
      <PlotWindowFrame win={win({ id: "w1" })} focused datasetName="ds1">
        <div>content</div>
      </PlotWindowFrame>,
    );
    const before = useApp.getState().plotWindows;
    fireEvent.pointerDown(document.querySelector(".qzk-plotwin-body")!, { clientX: 5, clientY: 5 });
    expect(useApp.getState().plotWindows).toBe(before); // no state churn
  });

  it("reflows a stranded position back on-canvas when `bounds` shrinks", () => {
    const stranded = win({ id: "w1", geometry: { x: 900, y: 900, w: 480, h: 360 } });
    useApp.setState({ plotWindows: [stranded, win({ id: "w2" })], focusedWindowId: "w1" });
    render(
      <PlotWindowFrame win={stranded} focused bounds={{ width: 300, height: 200 }} datasetName="ds1">
        <div>content</div>
      </PlotWindowFrame>,
    );
    const g = geomOf("w1");
    expect(g.x).toBeLessThanOrEqual(300);
    expect(g.y).toBeLessThanOrEqual(200);
  });

  it("double-clicking the title BAR toggles maximize/restore (item 8 — Origin habit)", () => {
    const { container } = render(
      <PlotWindowFrame win={win({ id: "w1", winState: "normal" })} focused datasetName="ds1">
        <div>content</div>
      </PlotWindowFrame>,
    );
    const titlebar = container.querySelector(".qzk-plotwin-titlebar")!;
    fireEvent.doubleClick(titlebar);
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")?.winState).toBe("maximized");
    fireEvent.doubleClick(titlebar);
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")?.winState).toBe("normal");
  });

  it("double-clicking the title TEXT renames inline instead of toggling maximize (item 10)", () => {
    useApp.setState({ plotWindows: [win({ id: "w1", title: "Old Name" }), win({ id: "w2" })], focusedWindowId: "w1" });
    const { container, getByDisplayValue } = render(
      <PlotWindowFrame win={win({ id: "w1", title: "Old Name" })} focused datasetName="ds1">
        <div>content</div>
      </PlotWindowFrame>,
    );
    fireEvent.doubleClick(container.querySelector(".qzk-plotwin-title")!);
    // Maximize must NOT have fired — the title-text handler stops propagation.
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")?.winState).toBe("normal");
    const input = getByDisplayValue("Old Name");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")?.title).toBe("New Name");
    expect(container.querySelector(".qzk-plotwin-rename")).toBeNull(); // editor closed
  });

  it("Escape cancels a rename in progress without committing", () => {
    useApp.setState({ plotWindows: [win({ id: "w1", title: "Old Name" }), win({ id: "w2" })], focusedWindowId: "w1" });
    const { container, getByDisplayValue } = render(
      <PlotWindowFrame win={win({ id: "w1", title: "Old Name" })} focused datasetName="ds1">
        <div>content</div>
      </PlotWindowFrame>,
    );
    fireEvent.doubleClick(container.querySelector(".qzk-plotwin-title")!);
    const input = getByDisplayValue("Old Name");
    fireEvent.change(input, { target: { value: "Discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")?.title).toBe("Old Name");
  });

  it("renders the item-10 channel-count/rows badge when `datasetMeta` is given", () => {
    const { container } = render(
      <PlotWindowFrame win={win({ id: "w1" })} focused datasetName="ds1" datasetMeta={{ channels: 3, rows: 120 }}>
        <div>content</div>
      </PlotWindowFrame>,
    );
    expect(container.querySelector(".qzk-plotwin-meta")?.textContent).toBe("3ch · 120pts");
  });

  // ── Item 12: edge/sibling snapping while dragging ─────────────────────────
  // The sibling w2 sits at the top-right so its edges (x 640/740, y 20/60)
  // never interfere with the canvas-edge cases below.
  const renderSnapFrame = () => {
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "w2", geometry: { x: 640, y: 20, w: 100, h: 40 } })],
      focusedWindowId: "w1",
    });
    return render(
      <PlotWindowFrame win={win({ id: "w1" })} focused bounds={{ width: 800, height: 600 }} datasetName="ds1">
        <div>content</div>
      </PlotWindowFrame>,
    );
  };

  it("a drag ending near a canvas edge snaps exactly onto it (item 12)", async () => {
    const { container } = renderSnapFrame();
    const titlebar = container.querySelector(".qzk-plotwin-titlebar")!;
    fireEvent.pointerDown(titlebar, { clientX: 100, clientY: 100, button: 0 });
    // Raw position would be x=7 — inside the 8px zone around the left edge.
    fireEvent.pointerMove(window, { clientX: 7, clientY: 150 });
    fireEvent.pointerUp(window, { clientX: 7, clientY: 150 });
    await waitFor(() => expect(geomOf("w1")).toEqual({ x: 0, y: 130, w: 480, h: 360 }));
  });

  it("holding Alt during the drag disables snapping (item 12)", async () => {
    const { container } = renderSnapFrame();
    const titlebar = container.querySelector(".qzk-plotwin-titlebar")!;
    fireEvent.pointerDown(titlebar, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 7, clientY: 150, altKey: true });
    fireEvent.pointerUp(window, { clientX: 7, clientY: 150, altKey: true });
    await waitFor(() => expect(geomOf("w1")).toEqual({ x: 7, y: 130, w: 480, h: 360 }));
  });

  it("a drag snaps the right edge to abut a sibling's left edge (item 12)", async () => {
    const { container } = renderSnapFrame();
    const titlebar = container.querySelector(".qzk-plotwin-titlebar")!;
    fireEvent.pointerDown(titlebar, { clientX: 100, clientY: 100, button: 0 });
    // Raw right edge would be 163+480 = 643 — 3px from w2's left edge (640).
    fireEvent.pointerMove(window, { clientX: 163, clientY: 100 });
    fireEvent.pointerUp(window, { clientX: 163, clientY: 100 });
    await waitFor(() => expect(geomOf("w1")).toEqual({ x: 160, y: 80, w: 480, h: 360 }));
  });

  it("a resize snaps the moving right edge onto the canvas edge (item 12)", async () => {
    const { container } = renderSnapFrame();
    const grip = container.querySelector(".qzk-plotwin-resize")!;
    fireEvent.pointerDown(grip, { clientX: 0, clientY: 0, button: 0 });
    // Raw size would be 695×400: right edge 795 → snaps to 800 (w 700);
    // bottom edge 480 is far from every line, so h stays 400 — the axes
    // snap independently.
    fireEvent.pointerMove(window, { clientX: 215, clientY: 40 });
    fireEvent.pointerUp(window, { clientX: 215, clientY: 40 });
    await waitFor(() => expect(geomOf("w1")).toEqual({ x: 100, y: 80, w: 700, h: 400 }));
  });
});

// ── Item 14: drop-a-Library-row-to-rebind + the per-window pin toggle ──────
// jsdom has no real DnD — hand-built events with a stub dataTransfer, the
// FolderRow.test.tsx / DatasetRow.test.tsx harness this borrows.

function datasetTransfer(id: string) {
  return {
    types: [DATASET_DND],
    getData: (t: string) => (t === DATASET_DND ? id : ""),
    setData: () => {},
  };
}

function fireDrag(el: Element, type: "dragover" | "dragleave" | "drop", dataTransfer: unknown) {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "dataTransfer", { value: dataTransfer, configurable: true });
  fireEvent(el, evt);
}

describe("PlotWindowFrame — item 14 (drop-to-rebind + pin toggle)", () => {
  const data = { time: [1], values: [[1]], labels: ["m"], units: [""], metadata: {} };

  beforeEach(() => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "a", data },
        { id: "d2", name: "b", data },
      ],
    });
  });

  it("highlights the frame while a dataset drag hovers it, and clears on dragleave", () => {
    const { container } = render(
      <PlotWindowFrame win={win({ id: "w2" })} focused={false} datasetName={undefined}>
        <div>content</div>
      </PlotWindowFrame>,
    );
    const frame = container.querySelector(".qzk-plotwin")!;
    fireDrag(frame, "dragover", datasetTransfer("d2"));
    expect(frame).toHaveClass("dropping");
    fireDrag(frame, "dragleave", datasetTransfer("d2"));
    expect(frame).not.toHaveClass("dropping");
  });

  it("a SNAPSHOT frame never advertises a rebind: no dragover highlight, drop falls through", () => {
    // rebindWindow no-ops on snapshots ("frozen means frozen") — so the frame
    // must not light up or swallow the drop; without preventDefault the drop
    // falls through to the canvas beneath, which opens a NEW window instead.
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "s1", kind: "snapshot", datasetId: null })],
      focusedWindowId: "w1",
    });
    const { container } = render(
      <PlotWindowFrame
        win={win({ id: "s1", kind: "snapshot", datasetId: null })}
        focused={false}
        datasetName={undefined}
      >
        <div>content</div>
      </PlotWindowFrame>,
    );
    const frame = container.querySelector(".qzk-plotwin")!;
    fireDrag(frame, "dragover", datasetTransfer("d2"));
    expect(frame).not.toHaveClass("dropping");
    fireDrag(frame, "drop", datasetTransfer("d2"));
    expect(useApp.getState().plotWindows.find((w) => w.id === "s1")?.datasetId).toBeNull();
  });

  it("ignores an unrelated drag type (no highlight, no rebind)", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "w2", datasetId: "d1" })],
      focusedWindowId: "w1",
    });
    const { container } = render(
      <PlotWindowFrame win={win({ id: "w2", datasetId: "d1" })} focused={false} datasetName="a">
        <div>content</div>
      </PlotWindowFrame>,
    );
    const frame = container.querySelector(".qzk-plotwin")!;
    const foreign = { types: ["Files"], getData: () => "", setData: () => {} };
    fireDrag(frame, "dragover", foreign);
    expect(frame).not.toHaveClass("dropping");
    fireDrag(frame, "drop", foreign);
    expect(useApp.getState().plotWindows.find((w) => w.id === "w2")?.datasetId).toBe("d1");
  });

  it("a drop rebinds THIS window via the store (background target — focus untouched)", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "w2", datasetId: "d1" })],
      focusedWindowId: "w1",
    });
    const { container } = render(
      <PlotWindowFrame win={win({ id: "w2", datasetId: "d1" })} focused={false} datasetName="a">
        <div>content</div>
      </PlotWindowFrame>,
    );
    fireDrag(container.querySelector(".qzk-plotwin")!, "drop", datasetTransfer("d2"));
    const s = useApp.getState();
    expect(s.plotWindows.find((w) => w.id === "w2")?.datasetId).toBe("d2");
    expect(s.focusedWindowId).toBe("w1"); // an explicit drop rebinds, it doesn't focus
    expect(container.querySelector(".qzk-plotwin")).not.toHaveClass("dropping"); // highlight cleared
  });

  it("a drop rebinds even a PINNED window (the explicit gesture beats the passive pin)", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1", datasetId: "d1", pinned: true }), win({ id: "w2" })],
      focusedWindowId: "w1",
    });
    const { container } = render(
      <PlotWindowFrame win={win({ id: "w1", datasetId: "d1", pinned: true })} focused datasetName="a">
        <div>content</div>
      </PlotWindowFrame>,
    );
    fireDrag(container.querySelector(".qzk-plotwin")!, "drop", datasetTransfer("d2"));
    const s = useApp.getState();
    expect(s.plotWindows.find((w) => w.id === "w1")?.datasetId).toBe("d2"); // rebound despite the pin
    expect(s.plotWindows).toHaveLength(2); // no retarget window spawned
  });

  it("the ⚲ pin button toggles this window's pin via the store (pressed state follows)", () => {
    const { getByLabelText, rerender } = render(
      <PlotWindowFrame win={win({ id: "w1" })} focused datasetName="a">
        <div>content</div>
      </PlotWindowFrame>,
    );
    fireEvent.click(getByLabelText("Pin window"));
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")?.pinned).toBe(true);
    // Re-render with the updated record (the prop is a snapshot in this harness).
    rerender(
      <PlotWindowFrame win={win({ id: "w1", pinned: true })} focused datasetName="a">
        <div>content</div>
      </PlotWindowFrame>,
    );
    const unpin = getByLabelText("Unpin window");
    expect(unpin).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(unpin);
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")?.pinned).toBe(false);
  });

  it("clicking the pin button does not also start a title-bar drag", () => {
    const { getByLabelText } = render(
      <PlotWindowFrame win={win({ id: "w1" })} focused datasetName="a">
        <div>content</div>
      </PlotWindowFrame>,
    );
    const before = geomOf("w1");
    fireEvent.pointerDown(getByLabelText("Pin window"), { clientX: 5, clientY: 5, button: 0 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 50 });
    fireEvent.pointerUp(window, { clientX: 50, clientY: 50 });
    expect(geomOf("w1")).toEqual(before);
  });
});
