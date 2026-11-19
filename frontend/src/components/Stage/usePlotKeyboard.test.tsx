// Keyboard access to the 2-D plot (usePlotKeyboard): data-order cursor walk,
// zoom/pan/reset through the SAME store action the toolbar tools use
// (recordView), and inertness while a text field has focus.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import type { PlotPayload } from "../../lib/plotdata";
import type { Readout } from "../../lib/uplotTools";
import { useApp } from "../../store/useApp";
import { stepIndex } from "./plotKeyboardCore";
import { usePlotKeyboard } from "./usePlotKeyboard";

// A 100x100 plot whose x spans [lo, hi] and y spans [ylo, yhi]; pixel <-> value is linear.
function fakePlot() {
  const scales: Record<string, { min: number; max: number }> = { x: { min: 0, max: 10 }, y: { min: 0, max: 10 } };
  const over = document.createElement("div");
  Object.defineProperty(over, "clientWidth", { value: 100 });
  Object.defineProperty(over, "clientHeight", { value: 100 });
  const u = {
    over,
    scales,
    valToPos: (v: number, k: string) => ((v - scales[k].min) / (scales[k].max - scales[k].min)) * 100,
    posToVal: (p: number, k: string) => scales[k].min + (p / 100) * (scales[k].max - scales[k].min),
    setScale: vi.fn((k: string, r: { min: number; max: number }) => { scales[k] = { min: r.min, max: r.max }; }),
    batch: (fn: () => void) => fn(),
    setData: vi.fn(() => { scales.x = { min: 0, max: 10 }; scales.y = { min: 0, max: 10 }; }),
  };
  return u;
}

// A loop: x goes 0 -> 4 -> 0 (non-ascending), plus a second series.
const LOOP: PlotPayload = {
  data: [[0, 2, 4, 2, 0], [1, 2, 3, 4, 5], [5, 4, 3, 2, 1]],
  series: [{ label: "up", unit: "" }, { label: "down", unit: "" }],
  xLabel: "H",
  xUnit: "Oe",
};

let u: ReturnType<typeof fakePlot>;
let readouts: (Readout | null)[];

function Harness({ payload = LOOP }: { payload?: PlotPayload }) {
  const kb = usePlotKeyboard({
    plotRef: { current: u as unknown as uPlot },
    payload,
    onViewChange: (b, a) => useApp.getState().recordView(b, a),
    onReadout: (r) => readouts.push(r),
    xLabel: "Field",
    yLabel: "Moment",
  });
  return (
    <div>
      <div data-testid="host" {...kb.hostProps} />
      <span data-testid="live">{kb.live}</span>
      <input data-testid="field" />
    </div>
  );
}

// The handlers live in a lazy chunk: let the dynamic import and its .then settle.
const key = async (el: Element, k: string, init: KeyboardEventInit = {}) => {
  await act(async () => {
    fireEvent.keyDown(el, { key: k, ...init });
    await vi.dynamicImportSettled();
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  u = fakePlot();
  readouts = [];
  useApp.setState({ xLim: null, yLim: null, viewHistory: [], viewFuture: [] });
});
afterEach(() => vi.useRealTimers());

describe("stepIndex", () => {
  it("skips non-finite points in data order", async () => {
    expect(stepIndex([0, 1, 2, 3], [1, null, 3, 4], 0, 1)).toBe(2);
    expect(stepIndex([0, 1, 2, 3], [1, null, 3, 4], 0, -1)).toBe(-1);
  });
});

describe("usePlotKeyboard", () => {
  it("is a focusable application with a descriptive name", async () => {
    render(<Harness />);
    const host = screen.getByTestId("host");
    expect(host.tabIndex).toBe(0);
    expect(host.getAttribute("role")).toBe("application");
    expect(host.getAttribute("aria-label")).toMatch(/^Plot: Moment vs Field, arrow keys move the cursor/);
  });

  it("walks points in DATA order on a non-ascending x and announces them", async () => {
    render(<Harness />);
    const host = screen.getByTestId("host");
    const xs: number[] = [];
    for (let n = 0; n < 5; n++) {
      await key(host, "ArrowRight");
      xs.push(readouts[readouts.length - 1]!.x);
    }
    expect(xs).toEqual([0, 2, 4, 2, 0]); // the loop returns through x=2, not sorted
    expect(screen.getByTestId("live").textContent).toBe("x = 0.0000, y = 5.0000 (up)");
    await key(host, "ArrowRight"); // clamps at the end
    expect(readouts[readouts.length - 1]!.x).toBe(0);
    await key(host, "ArrowLeft");
    expect(screen.getByTestId("live").textContent).toBe("x = 2.0000, y = 4.0000 (up)");
    expect(host.querySelector("[data-kb-cursor]")).toBeNull(); // marker lives in u.over
    expect(u.over.querySelector("[data-kb-cursor]")).not.toBeNull();
  });

  it("ArrowUp/Down switch series at the same point", async () => {
    render(<Harness />);
    const host = screen.getByTestId("host");
    await key(host, "ArrowRight");
    await key(host, "ArrowRight");
    await key(host, "ArrowDown");
    expect(screen.getByTestId("live").textContent).toBe("x = 2.0000, y = 4.0000 (down)");
    await key(host, "ArrowUp");
    expect(screen.getByTestId("live").textContent).toContain("(up)");
  });

  it("zoom and pan commit through recordView once per burst (one undo step)", async () => {
    render(<Harness />);
    const host = screen.getByTestId("host");
    await key(host, "+");
    await key(host, "=");
    expect(useApp.getState().viewHistory).toHaveLength(0); // coalescing
    act(() => { vi.advanceTimersByTime(200); });
    const s = useApp.getState();
    expect(s.viewHistory).toHaveLength(1);
    expect(s.viewHistory[0].before.xLim).toEqual([0, 10]);
    const [lo, hi] = s.xLim as [number, number];
    expect(hi - lo).toBeCloseTo(10 / 1.18 ** 2, 6);
    expect((lo + hi) / 2).toBeCloseTo(5, 6); // about the centre
    await key(host, "ArrowRight", { shiftKey: true });
    act(() => { vi.advanceTimersByTime(200); });
    expect(useApp.getState().viewHistory).toHaveLength(2);
    expect((useApp.getState().xLim as [number, number])[0]).toBeGreaterThan(lo);
    act(() => useApp.getState().backView());
    expect(useApp.getState().xLim).toEqual(s.xLim);
  });

  it("zooms about the data cursor", async () => {
    render(<Harness />);
    const host = screen.getByTestId("host");
    await key(host, "ArrowRight"); // x=0 -> left edge
    await key(host, "+");
    act(() => { vi.advanceTimersByTime(200); });
    expect((useApp.getState().xLim as [number, number])[0]).toBeCloseTo(0, 6);
  });

  it("Home and 0 reset to auto limits (like the toolbar reset)", async () => {
    render(<Harness />);
    const host = screen.getByTestId("host");
    await key(host, "-");
    act(() => { vi.advanceTimersByTime(200); });
    expect(useApp.getState().xLim).not.toBeNull();
    await key(host, "Home");
    expect(u.setData).toHaveBeenCalledWith(LOOP.data, true);
    expect(useApp.getState().xLim).toBeNull();
    expect(useApp.getState().yLim).toBeNull();
    await key(host, "-");
    act(() => { vi.advanceTimersByTime(200); });
    await key(host, "0");
    expect(useApp.getState().xLim).toBeNull();
  });

  it("is inert from a text field and with Ctrl/Meta/Alt", async () => {
    render(<Harness />);
    const field = screen.getByTestId("field");
    await key(field, "ArrowRight");
    await key(field, "+");
    await key(screen.getByTestId("host"), "ArrowRight", { altKey: true });
    await key(screen.getByTestId("host"), "+", { ctrlKey: true });
    act(() => { vi.advanceTimersByTime(200); });
    expect(readouts).toEqual([]);
    expect(useApp.getState().viewHistory).toHaveLength(0);
  });

  it("blur clears the cursor and the readout", async () => {
    render(<Harness />);
    const host = screen.getByTestId("host");
    await key(host, "ArrowRight");
    fireEvent.blur(host);
    expect(readouts[readouts.length - 1]).toBeNull();
    expect(screen.getByTestId("live").textContent).toBe("");
  });
});
