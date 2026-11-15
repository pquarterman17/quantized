// Origin gap audit 3 #15: graph layers over the plot — an inset graph of
// ANOTHER dataset on its own axes, an image and a table — placed on their
// saved frame fractions (where the export puts them), moved by drag and by
// keyboard (one undo step each), and an inset whose sources are gone shows
// the live graph's "sources are missing" notice instead of any curve.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import type uPlot from "uplot";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GraphLayer, InsetLayer } from "../../lib/graphLayers";
import { NO_CURVES_REASON } from "../../lib/linkedCurvesLite";
import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";
import { useFigureDialog } from "../../store/figureDialogs";
import { useApp } from "../../store/useApp";
import { plotWindowView } from "../../store/windowDocuments";
import GraphLayers from "./GraphLayers";

interface Opts {
  scales: Record<string, { range: () => [number, number] }>;
  axes: { splits: () => number[]; values: () => string[]; label?: string }[];
}
const { plots, MockUPlot } = vi.hoisted(() => {
  const plots: { opts: Opts; data: unknown[]; under: HTMLElement }[] = [];
  class MockUPlot {
    over = document.createElement("div");
    under = document.createElement("div");
    constructor(opts: Opts, data: unknown[]) {
      plots.push({ opts, data, under: this.under });
    }
    destroy(): void {}
    setSize(): void {}
  }
  return { plots, MockUPlot };
});
vi.mock("uplot", () => ({ default: MockUPlot }));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}
const realRO = globalThis.ResizeObserver;
beforeAll(() => void (globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver));
afterAll(() => void (globalThis.ResizeObserver = realRO));

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;

/** The main plot's frame: (50, 20) 400x200 inside the stage. */
function mainPlot() {
  const over = document.createElement("div");
  over.getBoundingClientRect = () => rect(50, 20, 400, 200);
  const ref = createRef<uPlot | null>() as { current: uPlot | null };
  ref.current = { over } as unknown as uPlot;
  return ref;
}

const other: Dataset = {
  id: "dmdh",
  name: "dM/dH",
  data: { time: [-50, 0, 50], values: [[1], [8], [1]], labels: ["dMdH"], units: [""], metadata: {} },
};
const insetLayer: InsetLayer = {
  id: "L1", kind: "inset", at: [0.1, 0.2, 0.3, 0.4], mark: "line",
  curves: [{ datasetId: "dmdh", xKey: null, yKey: 0, label: "" }],
  x: { lim: [-60, 60], scale: "linear", label: "H (Oe)", step: 30 },
  y: { lim: null, scale: "linear", label: "", step: null },
};
const table: GraphLayer = { id: "T1", kind: "table", at: [0.6, 0.6, 0.3, 0.2], rows: [["Hc", "Ms"], ["120", "1.2"]], header: true };

function mount() {
  const stage = document.body.appendChild(document.createElement("div"));
  stage.getBoundingClientRect = () => rect(0, 0, 600, 300);
  render(<GraphLayers plotRef={mainPlot()} />, { container: stage });
}

const initial = useApp.getState();
beforeEach(() => {
  useApp.setState({ datasets: [other], layers: [insetLayer, table], history: [], future: [], focusedWindowId: null });
});
afterEach(() => {
  plots.length = 0;
  useFigureDialog.setState({ open: null });
  useApp.setState({ datasets: initial.datasets, layers: initial.layers, plotWindows: initial.plotWindows });
});

describe("an inset graph layer of another dataset", () => {
  it("draws that dataset's curve on its own resolved axes (the export's ticks and text)", () => {
    mount();
    const { opts, data } = plots[0];
    expect(data).toEqual([[-50, 0, 50], [1, 8, 1]]);
    expect(opts.scales.x.range()).toEqual([-60, 60]);
    expect(opts.axes[0].splits()).toEqual([-60, -30, 0, 30, 60]);
    expect(opts.axes[0].values()).toEqual(["-60", "-30", "0", "30", "60"]);
    expect(opts.axes[0].label).toBe("H (Oe)");
    expect(opts.scales.y.range()).toEqual([0.65, 8.35]);
    expect(plots[0].under.style.background).not.toBe(""); // an opaque plot area, like the export's axes face
  });

  it("shows the sources-are-missing notice, never a curve, once its dataset is gone", () => {
    useApp.setState({ datasets: [] });
    mount();
    expect(screen.getByTestId("layer-notice").textContent).toBe(NO_CURVES_REASON);
    expect(plots).toHaveLength(0);
  });
});

describe("placement and editing", () => {
  it("a table sits exactly on its frame fractions", async () => {
    mount();
    const box = screen.getAllByTestId("graph-layer").find((b) => b.dataset.layerKind === "table")!;
    await waitFor(() => expect(box.style.left).toBe(`${50 + 0.6 * 400}px`));
    expect(box.style.top).toBe(`${20 + 0.6 * 200}px`);
    expect(box.style.width).toBe(`${0.3 * 400}px`);
    expect(box.style.height).toBe(`${0.2 * 200}px`);
    expect(screen.getByText("Hc").style.fontWeight).toBe("700");
    // Opaque, like the export's table cells: the curves under it do not show through.
    expect(screen.getByRole("table").style.background).not.toBe("");
  });

  it("drag moves a layer as ONE undo step; undo puts it back", async () => {
    mount();
    const box = screen.getAllByTestId("graph-layer").find((b) => b.dataset.layerKind === "table")!;
    await waitFor(() => expect(box.style.left).not.toBe("0px"));
    fireEvent.pointerDown(box, { button: 0, clientX: 300, clientY: 150, pointerId: 1 });
    fireEvent.pointerMove(box, { clientX: 260, clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(box, { pointerId: 1 });
    const at = () => useApp.getState().layers.find((l) => l.id === "T1")!.at;
    expect(at()[0]).toBeCloseTo(0.5);
    expect(at()[1]).toBeCloseTo(0.5);
    expect(useApp.getState().history).toHaveLength(1);
    act(() => useApp.getState().undo());
    expect(at()).toEqual([0.6, 0.6, 0.3, 0.2]);
  });

  it("a background window shows ITS view's layers and an edit lands on that window", () => {
    const view = { ...defaultPlotView(), layers: [table] };
    const win: PlotWindow = {
      id: "w2", kind: "plot", title: "B", datasetId: null, geometry: { x: 0, y: 0, w: 300, h: 200 }, z: 1,
      winState: "normal", view, bg: "theme", linkGroup: null, pinned: false,
    };
    useApp.setState({ plotWindows: [win], layers: [] });
    render(<GraphLayers plotRef={mainPlot()} view={view} windowId="w2" />);
    const box = screen.getByTestId("graph-layer");
    expect(box.hasAttribute("data-inset-box")).toBe(true); // the frame leaves the press to the layer
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(plotWindowView(useApp.getState().plotWindows[0]).layers[0].at[1]).toBeCloseTo(0.61);
    expect(useApp.getState().layers).toEqual([]);
  });

  it("arrow keys nudge, Enter opens its properties, Delete removes it (undoable)", () => {
    mount();
    const box = screen.getAllByTestId("graph-layer").find((b) => b.dataset.layerKind === "table")!;
    fireEvent.keyDown(box, { key: "ArrowLeft", shiftKey: true });
    expect(useApp.getState().layers.find((l) => l.id === "T1")!.at[0]).toBeCloseTo(0.55);
    vi.useFakeTimers();
    fireEvent.keyDown(box, { key: "Enter" });
    vi.runAllTimers();
    vi.useRealTimers();
    expect(useFigureDialog.getState().open).toEqual({ kind: "graphLayer", id: "T1" });
    fireEvent.keyDown(box, { key: "Delete" });
    expect(useApp.getState().layers.map((l) => l.id)).toEqual(["L1"]);
    act(() => useApp.getState().undo());
    expect(useApp.getState().layers.map((l) => l.id)).toEqual(["L1", "T1"]);
  });
});
