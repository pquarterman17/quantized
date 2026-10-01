// R9 code-review F1: PlotViewport.tsx's create/destroy effect reads
// `args.y2Fmt` (via `buildOpts`'s y2 tick formatter) but the effect's own
// dependency array omitted it — unlike its siblings `args.xFmt`/`args.yFmt`,
// which ARE listed. Real uPlot needs a browser canvas/layout engine neither
// jsdom nor this test cares about, so the constructor is mocked to a
// lightweight recorder (same pattern as MultiPanelStage.test.tsx /
// BackgroundPlotWindow.test.tsx) — a NEW recorded instance is this file's
// load-invariant proof that the create effect actually reran.

import { act, render, waitFor } from "@testing-library/react";
import { createRef, type RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import type { PlotPayload } from "../../lib/plotdata";
import PlotViewport, { type PlotViewportProps } from "./PlotViewport";

const { created, sizes, calls, MockUPlot } = vi.hoisted(() => {
  const created: unknown[] = [];
  const sizes: { width: number; height: number }[] = [];
  // Live-instance calls, in order, so the display-only tests can say HOW the
  // existing instance was updated (setSeries / redraw / setScale) — asserted
  // directly after the synchronous rerender, never through waitFor.
  const calls: unknown[][] = [];
  class MockUPlot {
    scales: Record<string, { min: number; max: number }> = { x: { min: 0, max: 1 }, y: { min: 0, max: 1 } };
    // uPlot keeps the opts' series objects as its live series (initSeries
    // fills defaults in place); the mock does the same so a test can read the
    // paint the NEXT draw would use straight off the instance.
    series: uPlot.Series[];
    bands: uPlot.Band[];
    constructor(opts: uPlot.Options, data: unknown) {
      created.push({ opts, data });
      this.series = opts.series;
      this.bands = opts.bands ?? [];
    }
    setBand(bi: number, b: uPlot.Band): void { Object.assign(this.bands[bi], b); }
    destroy(): void {}
    setSize(size: { width: number; height: number }): void { sizes.push(size); }
    setScale(key: string, lim: { min: number; max: number }): void { calls.push(["setScale", key, lim]); }
    setSeries(i: number, opts: { show?: boolean }): void {
      calls.push(["setSeries", i, opts]);
      if (opts.show != null) this.series[i].show = opts.show;
    }
    redraw(rebuildPaths?: boolean): void { calls.push(["redraw", rebuildPaths]); }
    batch(fn: (u: unknown) => void): void { fn(this); }
  }
  return { created, sizes, calls, MockUPlot };
});
vi.mock("uplot", () => ({ default: MockUPlot }));

class MockResizeObserver {
  static callbacks: ResizeObserverCallback[] = [];
  constructor(callback: ResizeObserverCallback) { MockResizeObserver.callbacks.push(callback); }
  observe(): void {}
  disconnect(): void {}
}

const PAYLOAD: PlotPayload = {
  data: [
    [0, 1, 2],
    [10, 20, 30],
  ],
  series: [{ label: "M", unit: "emu" }],
  xLabel: "Field",
  xUnit: "Oe",
};

function baseProps(): PlotViewportProps {
  return {
    displayPayload: PAYLOAD,
    plotRef: createRef<uPlot | null>(),
    theme: "light",
    accent: "blue",
    peakWizardEdit: null,
    anchorEdit: null,
    width: 600,
    height: 400,
    yScale: "linear",
    xScale: "linear",
    tool: "zoom",
    onReadout: vi.fn(),
  } as unknown as PlotViewportProps;
}

afterEach(() => {
  created.length = 0;
  sizes.length = 0;
  calls.length = 0;
  MockResizeObserver.callbacks.length = 0;
  vi.unstubAllGlobals();
});

describe("PlotViewport — create effect deps (R9 F1)", () => {
  it("rebuilds when y2Fmt changes, same as its xFmt/yFmt siblings", () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const props = baseProps();
    const { rerender } = render(<PlotViewport {...props} />);
    expect(created).toHaveLength(1);

    rerender(<PlotViewport {...props} y2Fmt={{ mode: "auto", digits: 4 }} />);
    expect(created).toHaveLength(2); // a NEW instance — the create effect reran
  });

  it("does not redraw uPlot for duplicate ResizeObserver deliveries", () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const { container } = render(<PlotViewport {...baseProps()} />);
    const host = container.firstElementChild as HTMLElement;
    Object.defineProperties(host, {
      clientWidth: { configurable: true, value: 720 },
      clientHeight: { configurable: true, value: 480 },
    });
    const callback = MockResizeObserver.callbacks.at(-1)!;
    act(() => callback([], {} as ResizeObserver));
    act(() => callback([], {} as ResizeObserver));
    expect(sizes).toEqual([{ width: 720, height: 480 }]);
  });
});

/** The live instance's resolved paint for display series `i` (uPlot index
 *  `i + 1`, since index 0 is x), evaluated the way uPlot's draw evaluates it. */
function livePaint(plotRef: RefObject<uPlot | null>, i: number, key: "stroke" | "fill"): unknown {
  const u = plotRef.current!;
  const v = u.series[i + 1][key];
  return typeof v === "function" ? v(u, i + 1) : v;
}

const TWO: PlotPayload = {
  ...PAYLOAD,
  data: [
    [0, 1, 2],
    [10, 20, 30],
    [5, 6, 7],
  ],
  series: [
    { label: "M", unit: "emu" },
    { label: "H", unit: "Oe" },
  ],
};

/** Let the lazily loaded patch (useLivePaint's dynamic import) run: its
 *  `then` was queued before this await on the same module promise. */
async function settlePatch(): Promise<void> {
  await act(async () => {
    await import("../../lib/uplotLivePaint");
  });
}

describe("PlotViewport — display-only changes patch the live instance", () => {
  it("a legend hide toggle keeps the instance and calls setSeries on the offset index", async () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const props = { ...baseProps(), displayPayload: TWO };
    const { rerender } = render(<PlotViewport {...props} hidden={[false, false]} />);
    expect(created).toHaveLength(1);

    rerender(<PlotViewport {...props} hidden={[false, true]} />);
    const u = props.plotRef.current!;
    await waitFor(() => expect(u.series[2].show).toBe(false)); // uPlot index 2 = display series 1
    expect(created).toHaveLength(1); // no new uPlot
    expect(u.series[1].show).toBe(true);
    expect(calls).toContainEqual(["setSeries", 2, { show: false }]);

    rerender(<PlotViewport {...props} hidden={[false, false]} />);
    await waitFor(() => expect(u.series[2].show).toBe(true));
    expect(created).toHaveLength(1);
  });

  it("a hide toggle re-applies the committed y limit instead of autoscaling it away", async () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const props = { ...baseProps(), displayPayload: TWO, yLim: [0, 50] as [number, number] };
    const { rerender } = render(<PlotViewport {...props} />);
    rerender(<PlotViewport {...props} hidden={[true, false]} />);
    await waitFor(() => expect(props.plotRef.current!.series[1].show).toBe(false));
    expect(created).toHaveLength(1);
    const i = calls.findIndex((c) => c[0] === "setSeries");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(calls.slice(i)).toContainEqual(["setScale", "y", { min: 0, max: 50 }]);
  });

  it("a colour/width/dash change keeps the instance and redraws with the new paint", async () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const props = baseProps();
    const { rerender } = render(<PlotViewport {...props} seriesStyles={[{ color: "#e03030" }]} />);
    expect(livePaint(props.plotRef, 0, "stroke")).toBe("#e03030");

    rerender(<PlotViewport {...props} seriesStyles={[{ color: "#30a0e0", width: 3, line: "dashed" }]} />);
    await waitFor(() => expect(livePaint(props.plotRef, 0, "stroke")).toBe("#30a0e0"));
    expect(created).toHaveLength(1); // no new uPlot
    const u = props.plotRef.current!;
    expect(u.series[1].width).toBe(3);
    expect(u.series[1].dash).toEqual([8, 4]);
    expect(calls.some((c) => c[0] === "redraw")).toBe(true);
  });

  it("a default line width change (baseLineWidth) patches the live width instead of rebuilding", async () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const props = baseProps();
    const { rerender } = render(<PlotViewport {...props} baseLineWidth={1.5} />);
    expect(props.plotRef.current!.series[1].width).toBe(1.5);

    rerender(<PlotViewport {...props} baseLineWidth={3} />);
    await waitFor(() => expect(props.plotRef.current!.series[1].width).toBe(3));
    expect(created).toHaveLength(1);
    expect(calls).toContainEqual(["redraw", true]); // width-sized gap clips rebuilt
  });

  it("a fill-under colour follows the stroke without a rebuild", async () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const props = baseProps();
    const { rerender } = render(<PlotViewport {...props} seriesStyles={[{ color: "#e03030", fill: "under" }]} />);
    rerender(<PlotViewport {...props} seriesStyles={[{ color: "#30a0e0", fill: "under" }]} />);
    await waitFor(() => expect(livePaint(props.plotRef, 0, "fill")).toContain("#30a0e0"));
    expect(created).toHaveLength(1);
  });

  it("a band fill (fill between two series) follows its series colour without a rebuild", async () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const props = { ...baseProps(), displayPayload: TWO, plotted: [0, 1] };
    const { rerender } = render(<PlotViewport {...props} seriesStyles={[{ color: "#e03030", fill: { vs: 1 } }, undefined]} />);
    rerender(<PlotViewport {...props} seriesStyles={[{ color: "#30a0e0", fill: { vs: 1 } }, undefined]} />);
    const u = props.plotRef.current!;
    const band = (created[0] as { opts: uPlot.Options }).opts.bands![0];
    const bandFill = () => (typeof band.fill === "function" ? band.fill(u, 0, "") : band.fill);
    await waitFor(() => expect(bandFill()).toContain("#30a0e0"));
    expect(created).toHaveLength(1);
    expect(band.series).toEqual([1, 2]);
  });

  it("a structural style change (markers on) still rebuilds, with the new markers", async () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const props = baseProps();
    const { rerender } = render(<PlotViewport {...props} seriesStyles={[{ color: "#e03030" }]} />);
    rerender(<PlotViewport {...props} seriesStyles={[{ color: "#e03030", marker: true, markerShape: "square" }]} />);
    await waitFor(() => expect(created).toHaveLength(2));
    expect((created[1] as { opts: uPlot.Options }).opts.series[1].points?.show).toBe(true);
    expect(calls).toEqual([]); // the live instance was not patched first
  });

  it("a series-count change rebuilds", () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const props = baseProps();
    const { rerender } = render(<PlotViewport {...props} hidden={[false]} />);
    rerender(<PlotViewport {...props} displayPayload={TWO} hidden={[false, false]} />);
    expect(created).toHaveLength(2);
    expect((created[1] as { opts: uPlot.Options }).opts.series).toHaveLength(3);
  });

  it("a hide toggle on a non-monotonic x (loop) rebuilds, since its y range scan excludes hidden series", () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const loop: PlotPayload = { ...TWO, data: [[0, 2, 1], ...TWO.data.slice(1)] };
    const props = { ...baseProps(), displayPayload: loop };
    const { rerender } = render(<PlotViewport {...props} hidden={[false, false]} />);
    rerender(<PlotViewport {...props} hidden={[true, false]} />);
    expect(created).toHaveLength(2);
  });

  it("a hide toggle on a waterfall X-offset layout rebuilds, since its x range covers visible series only", () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    // Ascending blocks (a step past the span): uPlot's own x range would apply.
    const blocks: PlotPayload = { ...TWO, data: [[0, 1, 5, 6], [1, 2, null, null], [null, null, 3, 4]], blockRows: 2 };
    const props = { ...baseProps(), displayPayload: blocks };
    const { rerender } = render(<PlotViewport {...props} hidden={[false, false]} />);
    rerender(<PlotViewport {...props} hidden={[false, true]} />);
    expect(created).toHaveLength(2);
    const range = (created[1] as { opts: uPlot.Options }).opts.scales?.x?.range as () => [number, number];
    expect(range()[1]).toBeLessThan(5); // the hidden series' block is not covered
  });

  it("an identical-content hidden/styles array with a new identity does nothing", async () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const props = baseProps();
    const { rerender } = render(<PlotViewport {...props} hidden={[false]} seriesStyles={[{ color: "#e03030" }]} />);
    rerender(<PlotViewport {...props} hidden={[false]} seriesStyles={[{ color: "#e03030" }]} />);
    await settlePatch();
    expect(created).toHaveLength(1);
    expect(calls).toEqual([]);
  });
});

// P2.8 residual (b): a half-open limit (one side null = auto for that side)
// is resolved against the canvas' own scanned extent before it reaches
// uPlot — the typed side is honoured, the blank side is the autoscale side.
describe("PlotViewport — half-open limits", () => {
  const optsOf = (i: number) => (created[i] as { opts: uPlot.Options }).opts;
  const xRange = (i: number) =>
    (optsOf(i).scales?.x?.range as unknown as (u: unknown, min: null, max: null) => [number, number])(null, null, null);

  it("fills a blank Y side from the data extent (y 10..30, soft-padded to 8..32)", () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    render(<PlotViewport {...baseProps()} yLim={[null, 25]} />);
    expect(optsOf(0).scales?.y?.range).toEqual([8, 25]);
  });

  it("fills a blank X side from the scanned x extent", () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    render(<PlotViewport {...baseProps()} xLim={[0.5, null]} />);
    expect(xRange(0)).toEqual([0.5, 2.04]);
  });

  it("an explicit side that crosses the auto side falls back to full auto and says so", () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const onLimCrossed = vi.fn();
    render(<PlotViewport {...baseProps()} yLim={[40, null]} onLimCrossed={onLimCrossed} />);
    const range = optsOf(0).scales?.y?.range;
    expect(Array.isArray(range) && range[0] === 40).toBe(false);
    expect(onLimCrossed).toHaveBeenCalledWith("y");
  });

  it("editing the typed side nudges the live instance, keeping the resolved auto side, without a rebuild", () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const props = { ...baseProps(), yLim: [null, 25] as [number | null, number | null] };
    const { rerender } = render(<PlotViewport {...props} />);
    rerender(<PlotViewport {...props} yLim={[null, 28]} />);
    expect(calls).toContainEqual(["setScale", "y", { min: 8, max: 28 }]);
    expect(created).toHaveLength(1);
  });
});
