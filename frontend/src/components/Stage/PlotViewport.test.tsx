// R9 code-review F1: PlotViewport.tsx's create/destroy effect reads
// `args.y2Fmt` (via `buildOpts`'s y2 tick formatter) but the effect's own
// dependency array omitted it — unlike its siblings `args.xFmt`/`args.yFmt`,
// which ARE listed. Real uPlot needs a browser canvas/layout engine neither
// jsdom nor this test cares about, so the constructor is mocked to a
// lightweight recorder (same pattern as MultiPanelStage.test.tsx /
// BackgroundPlotWindow.test.tsx) — a NEW recorded instance is this file's
// load-invariant proof that the create effect actually reran.

import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import type { PlotPayload } from "../../lib/plotdata";
import PlotViewport, { type PlotViewportProps } from "./PlotViewport";

const { created, sizes, MockUPlot } = vi.hoisted(() => {
  const created: unknown[] = [];
  const sizes: { width: number; height: number }[] = [];
  class MockUPlot {
    scales = { x: { min: 0, max: 1 } };
    constructor(opts: unknown, data: unknown) {
      created.push({ opts, data });
    }
    destroy(): void {}
    setSize(size: { width: number; height: number }): void { sizes.push(size); }
    setScale(): void {}
  }
  return { created, sizes, MockUPlot };
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
