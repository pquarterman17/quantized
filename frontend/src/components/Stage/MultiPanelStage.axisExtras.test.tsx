// Review finding (figures integration): the Axis dialog's extras -- a Y
// break, divide-by, minor ticks -- load on demand, and only the single-plot
// viewport asked for them. X-break panels, facet grids and stacks build their
// uPlots in the multi-panel stage, which never loaded the chunk: a session
// that opened straight into panels drew an unbroken, undivided axis while the
// export drew the break. The stage now loads it and rebuilds.

import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFigureDocument } from "../../lib/figureDocument";
import { defaultPlotView } from "../../lib/plotview";
import type { DataStruct } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";
import RealMultiPanelStage from "./MultiPanelStage";
import { useEffectiveComposition } from "./useEffectiveComposition";
import { axisExtrasApplier } from "../../lib/axisExtrasHook";

function MultiPanelStage() {
  const active = useActiveDataset();
  return <RealMultiPanelStage composition={useEffectiveComposition(active)} />;
}

type Opts = { scales?: { x?: { range?: unknown }; y?: { range?: unknown; distr?: number } } };
const { created, MockUPlot } = vi.hoisted(() => {
  const created: { opts: Opts }[] = [];
  class MockUPlot {
    static rangeNum = (lo: number, hi: number) => [lo - 1, hi + 1];
    static rangeLog = (lo: number, hi: number) => [lo / 10, hi * 10];
    scales = { x: { min: 0, max: 1 } };
    constructor(opts: Opts) {
      created.push({ opts });
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

/** x 0..10 | 100..110, every value positive. */
function gapData(): DataStruct {
  const time: number[] = [];
  const values: number[][] = [];
  for (const x0 of [0, 100]) {
    for (let i = 0; i <= 10; i++) {
      time.push(x0 + i);
      values.push([1 + i, 50 + i]);
    }
  }
  return { time, values, labels: ["A", "B"], units: ["", ""], metadata: {} };
}

function breakView(yLim: [number | null, number | null]): void {
  const data = gapData();
  useApp.setState({
    datasets: [{ id: "d1", name: "ds1", data }], activeId: "d1",
    xKey: null, yKeys: null, y2Keys: null, seriesOrder: null, hiddenChannels: [], stackMode: false,
    composition: null, facetKey: null, groupKey: null, seriesStyles: {}, seriesLabels: {},
    autoSeriesStyles: false, polarMode: false, statMode: false,
    yScale: "linear", yLim,
    yFmt: { mode: "auto", digits: 2, breaks: [[20, 45]] },
    plotWindows: [
      {
        id: "w1", kind: "plot", title: "", datasetId: "d1",
        geometry: { x: 0, y: 0, w: 480, h: 360 }, z: 0, winState: "normal",
        bg: "theme", linkGroup: null, pinned: false, view: defaultPlotView(),
        document: createFigureDocument({
          id: "fig-w1", name: "w1", datasetId: "d1", view: defaultPlotView(),
          axisBreaks: { x: [[20, 90]] },
        }),
      },
    ],
    focusedWindowId: "w1",
  });
}

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
  useApp.setState({ plotWindows: [], focusedWindowId: null, composition: null, yFmt: { mode: "auto", digits: 2 } });
});

describe("MultiPanelStage — the on-demand axis extras reach every panel", () => {
  it("x-break panels draw a Y break once the extras chunk lands", async () => {
    expect(axisExtrasApplier()).toBeNull(); // nothing in this file loaded it
    breakView([null, null]);
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(created.slice(-2).every(({ opts }) => opts.scales?.y?.distr === 100)).toBe(true));
    expect(axisExtrasApplier()).not.toBeNull();
  });
});
