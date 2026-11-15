// Plot audit round 3: the magnifier inset is a second view of the series the
// plot behind it draws, but it was always built linear-linear — a log-y XRD
// scan magnified onto a linear 0-200 axis that flattened every weak peak, and
// a reversed wavenumber axis ran the other way in the inset.

import { render } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { PlotPayload } from "../../lib/plotdata";
import { useApp } from "../../store/useApp";
import InsetPlot from "./InsetPlot";

const { created, MockUPlot } = vi.hoisted(() => {
  const created: { scales: Record<string, { distr?: number; dir?: number }>; series: { scale?: string; show?: boolean }[] }[] = [];
  class MockUPlot {
    constructor(opts: { scales: Record<string, { distr?: number; dir?: number }>; series: { scale?: string; show?: boolean }[] }) {
      created.push(opts);
    }
    destroy(): void {}
    setSize(): void {}
    setScale(): void {}
  }
  return { created, MockUPlot };
});
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

const initial = useApp.getState();
afterEach(() => {
  created.length = 0;
  useApp.setState({ yScale: initial.yScale, xScale: initial.xScale, xReversed: initial.xReversed });
});

describe("the magnifier inset", () => {
  it("draws on the focused plot's scales", () => {
    useApp.setState({ yScale: "log", xScale: "linear", xReversed: true });
    render(<InsetPlot payload={payload} />);
    const scales = created[created.length - 1].scales;
    expect(scales.y.distr).toBe(3);
    expect(scales.x.dir).toBe(-1);
  });

  it("draws on a background window's own scales when handed its view", () => {
    useApp.setState({ yScale: "linear", xScale: "linear", xReversed: false });
    render(<InsetPlot payload={payload} view={{ yScale: "log", xScale: "linear", y2Scale: null, xReversed: false }} />);
    expect(created[created.length - 1].scales.y.distr).toBe(3);
  });

  it("magnifies Y1 and Y2 series only: a Y3+ series is not drawn, as in the export (gap audit 4 G11)", () => {
    const multi: PlotPayload = {
      ...payload,
      data: [[10, 20, 30, 40], [5, 50, 500, 50], [1, 2, 3, 4], [6, 7, 8, 9]],
      series: [{ label: "I", unit: "" }, { label: "J", unit: "", axis: 1 }, { label: "K", unit: "", axis: 2 }],
    };
    render(<InsetPlot payload={multi} />);
    expect(created[created.length - 1].series.slice(1).map((s) => s.show)).toEqual([true, true, false]);
  });
});
