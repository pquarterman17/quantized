// UX-A: a Pointer-tool click on the plot selects (a drag does not), the
// selection gets an on-canvas halo, and Escape clears it.

import { act, fireEvent, render } from "@testing-library/react";
import type uPlot from "uplot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pressEscape } from "../../test/pressEscape";
import { makeFakePlot, OVER, type FakePlot } from "../../test/plotSelectionFixture";
import { usePlotSelection } from "../../store/plotSelection";
import { useApp } from "../../store/useApp";
import PlotSelectionLayer from "./PlotSelectionLayer";

let plot: FakePlot;

function mount(tool: "pointer" | "zoom" = "pointer") {
  const ref = { current: plot.u as uPlot | null };
  // The halo SVG lives in the stage, like PlotStageOverlays mounts it (in its
  // own host: React clears a container it renders into).
  const host = plot.stage.appendChild(document.createElement("div"));
  host.getBoundingClientRect = plot.stage.getBoundingClientRect;
  return render(<PlotSelectionLayer plotRef={ref} plotted={[0, 1]} tool={tool} />, { container: host });
}

/** A click at data (x, y) — mousedown at `from` (default: the same point). */
function clickData(x: number, y: number, from?: [number, number]) {
  const cx = OVER.left + x * 10;
  const cy = OVER.top + (10 - y) * 10;
  const [dx, dy] = from ?? [cx, cy];
  fireEvent.mouseDown(plot.over, { clientX: dx, clientY: dy });
  fireEvent.click(plot.over, { clientX: cx, clientY: cy });
}

beforeEach(() => {
  usePlotSelection.setState({ sel: null });
  useApp.setState({ selectedAnnotationId: null, selectedShapeId: null });
  plot = makeFakePlot();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PlotSelectionLayer", () => {
  it("selects the clicked curve and draws its halo", () => {
    const { container } = mount();
    expect(container.querySelector(".qzk-selection-halo")).toBeNull();
    act(() => clickData(2, 2));
    expect(usePlotSelection.getState().sel).toEqual({ kind: "series", channel: 0 });
    const halo = container.querySelector(".qzk-selection-halo");
    expect(halo?.getAttribute("data-selection")).toBe("series:0");
    expect(halo?.querySelector("path")?.getAttribute("d")).toMatch(/^M50\.0,120\.0L60\.0,110\.0/);
  });

  it("outlines a clicked axis", () => {
    const { container } = mount();
    act(() => {
      fireEvent.mouseDown(plot.axisX, { clientX: 100, clientY: 140 });
      fireEvent.click(plot.axisX, { clientX: 100, clientY: 140 });
    });
    expect(usePlotSelection.getState().sel).toEqual({ kind: "axis", axis: "x" });
    const box = container.querySelector(".qzk-selection-box");
    expect(box?.getAttribute("display")).toBe("inline");
    expect(box?.getAttribute("y")).toBe("120");
  });

  it("selects the legend", () => {
    mount();
    act(() => {
      fireEvent.mouseDown(plot.legend, { clientX: 130, clientY: 35 });
      fireEvent.click(plot.legend, { clientX: 130, clientY: 35 });
    });
    expect(usePlotSelection.getState().sel).toEqual({ kind: "legend" });
  });

  it("a click on empty plot area clears the selection", () => {
    mount();
    act(() => clickData(2, 2));
    act(() => clickData(1, 5));
    expect(usePlotSelection.getState().sel).toBeNull();
  });

  it("a drag (the box zoom) selects nothing", () => {
    mount();
    act(() => clickData(2, 2, [OVER.left + 80, OVER.top + 10]));
    expect(usePlotSelection.getState().sel).toBeNull();
  });

  it("only the Pointer tool selects", () => {
    mount("zoom");
    act(() => clickData(2, 2));
    expect(usePlotSelection.getState().sel).toBeNull();
  });

  it("selecting a curve drops an annotation selection", () => {
    useApp.setState({ selectedAnnotationId: "a1" });
    mount();
    act(() => clickData(2, 2));
    expect(useApp.getState().selectedAnnotationId).toBeNull();
  });

  it("Escape clears the selection", async () => {
    const { container } = mount();
    act(() => clickData(2, 2));
    await pressEscape();
    expect(usePlotSelection.getState().sel).toBeNull();
    expect(container.querySelector(".qzk-selection-halo")).toBeNull();
  });

  it("the selection is dropped when the plot unmounts (view state only)", () => {
    const view = mount();
    act(() => clickData(2, 2));
    view.unmount();
    expect(usePlotSelection.getState().sel).toBeNull();
  });

  it("a click on a legend row selects that curve; Alt+click is left to the row's hide/show", () => {
    mount();
    const row = plot.legend.appendChild(document.createElement("div"));
    row.dataset.channel = "1";
    act(() => {
      fireEvent.mouseDown(row, { clientX: 130, clientY: 35 });
      fireEvent.click(row, { clientX: 130, clientY: 35 });
    });
    expect(usePlotSelection.getState().sel).toEqual({ kind: "series", channel: 1 });
    act(() => usePlotSelection.setState({ sel: null }));
    act(() => {
      fireEvent.mouseDown(row, { clientX: 130, clientY: 35 });
      fireEvent.click(row, { clientX: 130, clientY: 35, altKey: true });
    });
    expect(usePlotSelection.getState().sel).toBeNull();
  });

  it("a click with no press of its own is not measured against a stale one", () => {
    mount();
    // A press far away, then its click (a drag: ignored) …
    act(() => clickData(2, 2, [OVER.left + 80, OVER.top + 10]));
    // … then a click with no pointerdown (keyboard / synthetic): still a click.
    act(() => {
      fireEvent.click(plot.over, { clientX: OVER.left + 20, clientY: OVER.top + 80 });
    });
    expect(usePlotSelection.getState().sel).toEqual({ kind: "series", channel: 0 });
  });

  it("recomputes the halo only when the plot changes, not on every frame", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    try {
      const calls = vi.spyOn(plot.u, "valToPos");
      const { container } = mount();
      act(() => clickData(2, 2));
      const path = () => container.querySelector(".qzk-selection-halo path")?.getAttribute("d");
      const first = path();
      const n = calls.mock.calls.length;
      act(() => {
        vi.advanceTimersByTime(500); // ~30 frames, nothing changed
      });
      expect(calls.mock.calls.length).toBe(n);
      // A zoom: the next frame redraws the halo.
      plot.u.scales.x.min = 1;
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(calls.mock.calls.length).toBeGreaterThan(n);
      expect(path()).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears a curve selection when the dataset's columns change (an index would name another curve)", () => {
    const data = { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["A", "B"], units: ["", ""], metadata: {} };
    useApp.setState({ datasets: [{ id: "d1", name: "s", data }], activeId: "d1" });
    mount();
    act(() => clickData(2, 2));
    expect(usePlotSelection.getState().sel).not.toBeNull();
    act(() => useApp.setState({ datasets: [{ id: "d1", name: "s", data: { ...data, labels: ["B", "C"] } }] }));
    expect(usePlotSelection.getState().sel).toBeNull();
  });

  it("clears a stale Y2 axis selection when the last Y2 curve goes", () => {
    useApp.setState({ y2Keys: [1] });
    mount();
    act(() => usePlotSelection.setState({ sel: { kind: "axis", axis: "y2" } }));
    act(() => useApp.setState({ y2Keys: [] }));
    expect(usePlotSelection.getState().sel).toBeNull();
  });

  it("a tap on an annotation over a curve never selects the curve (the plugin's geometric hit, no hover cursor)", () => {
    // Stand-in for annotationPlugin: a capture listener on the chart root that
    // hit-tests by geometry on mousedown and claims the press. No cursor is
    // ever set, as on touch.
    plot.root.addEventListener(
      "mousedown",
      (e) => {
        e.preventDefault();
        useApp.setState({ selectedAnnotationId: "a1" });
      },
      true,
    );
    mount();
    act(() => clickData(2, 2));
    expect(plot.over.style.cursor).toBe("");
    expect(usePlotSelection.getState().sel).toBeNull();
    expect(useApp.getState().selectedAnnotationId).toBe("a1");
  });

  it("dims the halo while another tool is active", () => {
    usePlotSelection.setState({ sel: { kind: "series", channel: 0 } });
    const { container, rerender } = mount("zoom");
    const halo = () => container.querySelector(".qzk-selection-halo");
    expect(halo()).toHaveClass("qzk-selection-idle");
    const ref = { current: plot.u as uPlot | null };
    rerender(<PlotSelectionLayer plotRef={ref} plotted={[0, 1]} tool="pointer" />);
    expect(halo()).not.toHaveClass("qzk-selection-idle");
  });
});

