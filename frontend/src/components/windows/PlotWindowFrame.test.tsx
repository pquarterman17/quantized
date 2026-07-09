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
});
