// Plot audit leftovers: the magnifier inset was screen-only — its region and
// placement lived only inside the uPlot instance, so a save, a reopen and
// every export path lost it. It is view state now (`PlotView.inset`): the
// inset writes the region it draws (and whether y was the user's zoom), sits
// with its PLOT AREA on the saved frame fractions (where the export puts its
// inset axes), moves and resizes by drag, toggles its connector lines, and
// draws the source outline on the main plot. A background window's inset only
// reads its saved geometry.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import type uPlot from "uplot";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_INSET_AT } from "../../lib/inset";
import type { PlotPayload } from "../../lib/plotdata";
import { defaultPlotView, type InsetView } from "../../lib/plotview";
import { useApp } from "../../store/useApp";
import { plotWindowView } from "../../store/windowDocuments";
import InsetPlot from "./InsetPlot";

type Hook = (u: MockUPlot, key: string) => void;
const { plots, MockUPlot } = vi.hoisted(() => {
  const plots: MockUPlot[] = [];
  class MockUPlot {
    scales: Record<string, { min: number | null; max: number | null }> = { x: { min: 10, max: 40 }, y: { min: 0, max: 600 } };
    over = document.createElement("div");
    setCalls: [string, number, number][] = [];
    hooks: Hook[];
    constructor(opts: { hooks?: { setScale?: Hook[] }; scales?: Record<string, unknown> }) {
      this.hooks = opts.hooks?.setScale ?? [];
      if (opts.scales?.y2) this.scales.y2 = { min: 1, max: 9 }; // a dual-Y plot's secondary scale
      plots.push(this);
      this.hooks.forEach((h) => h(this, "x")); // creation's own autoscale
    }
    setScale(key: string, r: { min: number; max: number }): void {
      this.setCalls.push([key, r.min, r.max]);
      this.scales[key] = { ...r };
      this.hooks.forEach((h) => h(this, key));
    }
    destroy(): void {}
    setSize(): void {}
  }
  return { plots, MockUPlot };
});
type MockUPlot = InstanceType<typeof MockUPlot>;
vi.mock("uplot", () => ({ default: MockUPlot }));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}
const realRO = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
});
afterAll(() => {
  globalThis.ResizeObserver = realRO;
});

const payload: PlotPayload = {
  data: [
    [10, 20, 30, 40],
    [5, 50, 500, 50],
  ],
  series: [{ label: "I", unit: "cps" }],
  xLabel: "2Theta",
  xUnit: "deg",
};

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;

/** A main plot whose frame sits at (50, 20) 400x200 in the stage, x 10..40 and y 0..600 mapped linearly. */
function mainPlot() {
  const over = document.createElement("div");
  over.getBoundingClientRect = () => rect(50, 20, 400, 200);
  const ref = createRef<uPlot | null>() as { current: uPlot | null };
  ref.current = {
    over,
    valToPos: (v: number, key: string) => (key === "x" ? ((v - 10) / 30) * 400 : (1 - v / 600) * 200),
  } as unknown as uPlot;
  return ref;
}

const initial = useApp.getState();
beforeEach(() => {
  useApp.setState({ inset: null, xScale: "linear", yScale: "linear", y2Scale: null, xReversed: false, showGrid: true });
});
afterEach(() => {
  plots.length = 0;
  useApp.setState({ inset: initial.inset, yScale: initial.yScale, plotWindows: initial.plotWindows, focusedWindowId: initial.focusedWindowId });
});

const saved: InsetView = { x: [15, 25], y: [1, 100], yZoom: true, at: [0.1, 0.2, 0.3, 0.4], lines: true };

describe("the magnifier inset's view state", () => {
  it("seeds the central third and saves it, at the default placement", async () => {
    render(<InsetPlot payload={payload} />);
    expect(plots[0].setCalls[0]).toEqual(["x", 20.5, 29.5]);
    await waitFor(() => expect(useApp.getState().inset?.x).toEqual([20.5, 29.5]));
    expect(useApp.getState().inset).toMatchObject({ yZoom: false, at: [...DEFAULT_INSET_AT], lines: true });
  });

  it("reopens on the saved region, including a zoomed y", () => {
    useApp.setState({ inset: saved });
    render(<InsetPlot payload={payload} />);
    expect(plots[0].setCalls).toEqual([["x", 15, 25], ["y", 1, 100]]);
    expect(useApp.getState().inset).toEqual(saved);
  });

  it("does not re-apply a saved y that a log axis cannot show", () => {
    useApp.setState({ inset: { ...saved, y: [-5, 100] }, yScale: "log" });
    render(<InsetPlot payload={payload} />);
    expect(plots[0].setCalls).toEqual([["x", 15, 25]]);
  });

  it("records a box zoom as a user y zoom, and a double-click reset as autoscaled", async () => {
    render(<InsetPlot payload={payload} />);
    const u = plots[0];
    fireEvent.mouseDown(u.over, { button: 0 });
    act(() => {
      u.setScale("x", { min: 12, max: 18 });
      u.setScale("y", { min: 2, max: 60 });
    });
    fireEvent.mouseUp(window);
    await waitFor(() => expect(useApp.getState().inset).toMatchObject({ x: [12, 18], y: [2, 60], yZoom: true }));
    fireEvent.dblClick(u.over);
    act(() => {
      u.setScale("x", { min: 10, max: 40 });
      u.setScale("y", { min: 0, max: 600 });
    });
    await waitFor(() => expect(useApp.getState().inset).toMatchObject({ x: [10, 40], y: [0, 600], yZoom: false }));
  });

  // Batch 33: a dual-Y inset draws its y2 series on their own scale (the
  // plot's y2), which a box zoom re-ranges with y; that range is saved and
  // exported too, or the export's secondary axis would not match the screen.
  const dualPayload: PlotPayload = {
    ...payload,
    data: [
      [10, 20, 30, 40],
      [5, 50, 500, 50],
      [1, 2, 9, 3],
    ],
    series: [{ label: "I", unit: "cps", axis: 0 }, { label: "T", unit: "K", axis: 1 }],
  };

  it("records a dual-Y inset's secondary range as drawn, and its zoom", async () => {
    render(<InsetPlot payload={dualPayload} />);
    await waitFor(() => expect(useApp.getState().inset?.y2).toEqual([1, 9]));
    const u = plots[0];
    fireEvent.mouseDown(u.over, { button: 0 });
    act(() => {
      u.setScale("y", { min: 2, max: 60 });
      u.setScale("y2", { min: 2, max: 5 });
    });
    fireEvent.mouseUp(window);
    await waitFor(() => expect(useApp.getState().inset).toMatchObject({ y: [2, 60], y2: [2, 5], yZoom: true }));
  });

  it("reopens a zoomed dual-Y inset on its saved secondary range", () => {
    useApp.setState({ inset: { ...saved, y2: [2, 8] } });
    render(<InsetPlot payload={dualPayload} />);
    expect(plots[0].setCalls).toEqual([["x", 15, 25], ["y", 1, 100], ["y2", 2, 8]]);
  });

  it("toggles the connector lines", () => {
    useApp.setState({ inset: saved });
    render(<InsetPlot payload={payload} />);
    fireEvent.click(screen.getByRole("button", { name: "Connector lines" }));
    expect(useApp.getState().inset?.lines).toBe(false);
  });
});

describe("the magnifier inset's placement and outline", () => {
  it("puts its plot area on the saved frame fractions and outlines the source region", async () => {
    useApp.setState({ inset: { ...saved, lines: true } });
    const stage = document.body.appendChild(document.createElement("div"));
    stage.getBoundingClientRect = () => rect(0, 0, 600, 300);
    render(<InsetPlot payload={payload} plotRef={mainPlot()} />, { container: stage });
    const box = screen.getByTestId("inset-box");
    // Plot area = frame (50, 20, 400x200) * at (0.1, 0.2, 0.3, 0.4), less the unmeasured chrome guess.
    await waitFor(() => expect(box.style.left).toBe(`${50 + 40 - 52}px`));
    expect(box.style.top).toBe(`${20 + 40 - 30}px`);
    expect(box.style.width).toBe(`${120 + 52 + 10}px`);
    const svg = screen.getByTestId("inset-indicator");
    const outline = svg.querySelectorAll("rect")[1];
    // Source x 15..25 -> 66.7..200 px; y 1..100 -> 199.7..166.7 px, plus the frame's offset.
    expect(Number(outline.getAttribute("x"))).toBeCloseTo(50 + 66.667, 2);
    expect(Number(outline.getAttribute("width"))).toBeCloseTo(133.333, 2);
    expect(Number(outline.getAttribute("y"))).toBeCloseTo(20 + 166.667, 2);
    const wires = screen.getByTestId("inset-connectors");
    const shown = [...wires.querySelectorAll("line")].filter((l) => l.getAttribute("display") !== "none");
    expect(shown).toHaveLength(2);
  });

  it("moves by its header and saves the new placement as one undo step", async () => {
    useApp.setState({ inset: saved });
    const record = vi.spyOn(useApp.getState(), "recordHistory");
    const stage = document.body.appendChild(document.createElement("div"));
    stage.getBoundingClientRect = () => rect(0, 0, 600, 300);
    render(<InsetPlot payload={payload} plotRef={mainPlot()} />, { container: stage });
    const header = screen.getByTitle("Drag to move the inset.");
    await waitFor(() => expect(screen.getByTestId("inset-box").style.left).not.toBe(""));
    fireEvent.pointerDown(header, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(header, { clientX: 140, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(header, { clientX: 140, clientY: 120, pointerId: 1 });
    const at = useApp.getState().inset?.at ?? [];
    expect(at[0]).toBeCloseTo(0.2); // +40 px of a 400 px frame
    expect(at[1]).toBeCloseTo(0.3); // +20 px of a 200 px frame
    expect(record).toHaveBeenCalledWith("move inset");
  });

  // Batch 33: a background window's inset used to discard every edit (and
  // the frame's focus swap unmounted it mid-drag). Edits now land on THAT
  // window's view, undoably, never on the focused window's live inset.
  function BackgroundInset({ id, plotRef }: { id: string; plotRef?: ReturnType<typeof mainPlot> }) {
    const win = useApp((s) => s.plotWindows.find((w) => w.id === id));
    return win ? <InsetPlot payload={payload} view={plotWindowView(win)} windowId={id} plotRef={plotRef} /> : null;
  }
  const bgWindow = (inset: InsetView | null = saved) => {
    const id = useApp.getState().createWindow(null, { ...defaultPlotView(), insetMode: true, inset });
    expect(useApp.getState().focusedWindowId).not.toBe(id);
    return id;
  };
  const bgView = (id: string) => plotWindowView(useApp.getState().plotWindows.find((w) => w.id === id)!);

  it("a background window's inset moves its own window's inset, as one undo step", async () => {
    const id = bgWindow();
    const stage = document.body.appendChild(document.createElement("div"));
    stage.getBoundingClientRect = () => rect(0, 0, 600, 300);
    render(<BackgroundInset id={id} plotRef={mainPlot()} />, { container: stage });
    const header = screen.getByTitle("Drag to move the inset.");
    await waitFor(() => expect(screen.getByTestId("inset-box").style.left).not.toBe(""));
    expect(bgView(id).inset).toEqual(saved); // mounting writes nothing
    fireEvent.pointerDown(header, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(header, { clientX: 140, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(header, { clientX: 140, clientY: 120, pointerId: 1 });
    expect(bgView(id).inset?.at[0]).toBeCloseTo(0.2);
    expect(bgView(id).inset?.at[1]).toBeCloseTo(0.3);
    expect(useApp.getState().inset).toBeNull(); // the focused window's inset is untouched
    act(() => useApp.getState().undo());
    expect(bgView(id).inset?.at).toEqual(saved.at);
  });

  it("a background window's inset writes nothing until the user edits it", () => {
    const id = bgWindow(null);
    render(<BackgroundInset id={id} />);
    expect(plots[plots.length - 1].setCalls[0]).toEqual(["x", 20.5, 29.5]); // seeded and drawn...
    expect(bgView(id).inset).toBeNull(); // ...but not written into the window
  });

  it("a background window's inset saves a box zoom to that window, then focuses it", async () => {
    const id = bgWindow();
    render(<BackgroundInset id={id} />);
    const u = plots[plots.length - 1];
    fireEvent.mouseDown(u.over, { button: 0 });
    act(() => {
      u.setScale("x", { min: 16, max: 18 });
      u.setScale("y", { min: 2, max: 60 });
    });
    fireEvent.mouseUp(window);
    await waitFor(() => expect(bgView(id).inset).toMatchObject({ x: [16, 18], y: [2, 60], yZoom: true }));
    // Then the window takes focus, carrying the zoom into the live view.
    await waitFor(() => expect(useApp.getState().focusedWindowId).toBe(id));
    expect(useApp.getState().inset).toMatchObject({ x: [16, 18], yZoom: true });
  });

  it("a background window's inset saves its line toggle and its close to that window", () => {
    const id = bgWindow();
    render(<BackgroundInset id={id} />);
    fireEvent.click(screen.getByRole("button", { name: "Connector lines" }));
    expect(bgView(id).inset?.lines).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Close inset" }));
    expect(bgView(id).insetMode).toBe(false);
    expect(useApp.getState().inset).toBeNull();
  });

  it("a background window's inset reads its saved geometry and writes nothing", () => {
    render(
      <InsetPlot
        payload={payload}
        view={{ xScale: "linear", yScale: "linear", y2Scale: null, xReversed: false, inset: saved }}
      />,
    );
    expect(plots[0].setCalls).toEqual([["x", 15, 25], ["y", 1, 100]]);
    expect(useApp.getState().inset).toBeNull();
  });
});
