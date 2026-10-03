// A limit with a typed side <= 0 on a LOG axis, on x-break panels (shared Y)
// and a facet grid (shared X). uPlot cannot draw a log10(0) bound, and the
// export's matplotlib ignores a non-positive limit side on a log axis (it keeps
// the autoscale), so the shared panel range treats that side as auto — the
// flat canvas' rule (`lib/canvasLims.drawableLim`).

import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFigureDocument } from "../../lib/figureDocument";
import { defaultPlotView } from "../../lib/plotview";
import type { DataStruct } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";
import RealMultiPanelStage from "./MultiPanelStage";
import { useEffectiveComposition } from "./useEffectiveComposition";

function MultiPanelStage() {
  const active = useActiveDataset();
  return <RealMultiPanelStage composition={useEffectiveComposition(active)} />;
}

type Opts = { scales?: { x?: { range?: unknown }; y?: { range?: unknown } } };
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
    yScale: "log", yLim,
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
  useApp.setState({
    plotWindows: [], focusedWindowId: null, composition: null, facetKey: null,
    xScale: "linear", yScale: "linear", xLim: null, yLim: null,
  });
});

describe("MultiPanelStage — facet grid on a log X with a non-positive typed side", () => {
  it("keeps the typed right edge and draws an auto, positive left edge", async () => {
    const rows = [[1, 0, 5], [2, 0, 6], [4, 0, 7], [1, 1, 8], [2, 1, 9], [4, 1, 10]];
    const data: DataStruct = { time: rows.map((_, i) => i), values: rows, labels: ["B", "level", "M"], units: ["", "", ""], metadata: {} };
    useApp.setState({
      datasets: [{ id: "f1", name: "f.csv", data }], activeId: "f1", xKey: 0, yKeys: null, y2Keys: null,
      seriesOrder: null, stackMode: true, composition: null, facetKey: null, groupKey: null,
      seriesLabels: {}, seriesStyles: {}, hiddenChannels: [], plotWindows: [], focusedWindowId: null,
    });
    useApp.getState().facetByColumn("f1", 1);
    useApp.setState({ xScale: "log", xLim: [0, 3] });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created).toHaveLength(2));
    for (const { opts } of created) {
      // A fixed X range is a function answering its limit for uPlot's autoscale call.
      const range = opts.scales?.x?.range as (u: unknown, min: null, max: null) => [number, number];
      const lim = range({ data: [[]] }, null, null);
      expect(lim[1]).toBe(3);
      expect(lim[0]).toBeGreaterThan(0);
    }
  });
});

describe("MultiPanelStage — break panels on a log Y with a non-positive typed side", () => {
  it("keeps the typed top and draws an auto, positive bottom", async () => {
    breakView([0, 80]);
    render(<MultiPanelStage />);
    await waitFor(() => expect(created).toHaveLength(2));
    for (const { opts } of created) {
      const range = opts.scales?.y?.range as [number, number];
      expect(range[1]).toBe(80);
      expect(range[0]).toBeGreaterThan(0);
    }
  });

  // Plot audit round 3: zero-count rows (a real Bruker scan has 211) made the
  // AUTO shared range start at 0 — two blank log panels.
  it("an auto range skips zero counts", async () => {
    breakView([null, null]);
    const ds = useApp.getState().datasets[0];
    useApp.setState({ datasets: [{ ...ds, data: { ...ds.data, values: ds.data.values.map((r, i) => (i % 3 ? r : [0, r[1]])) } }] });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created).toHaveLength(2));
    for (const { opts } of created) expect((opts.scales?.y?.range as [number, number])[0]).toBeGreaterThan(0);
  });

  // Plot audit round 4: the auto shared range is padded by uPlot's own rule
  // (here the mock's), as an unbroken plot is; a typed side is not.
  it("pads a full-auto range by the unbroken rule, not a typed one", async () => {
    breakView([null, null]);
    render(<MultiPanelStage />);
    await waitFor(() => expect(created).toHaveLength(2));
    for (const { opts } of created) expect(opts.scales?.y?.range).toEqual([0.1, 600]);
  });

  it("a half-open pair whose only typed side is <= 0 is full auto, still positive", async () => {
    breakView([0, null]);
    render(<MultiPanelStage />);
    await waitFor(() => expect(created).toHaveLength(2));
    for (const { opts } of created) {
      const range = opts.scales?.y?.range as [number, number];
      expect(range[0]).toBeGreaterThan(0);
    }
  });
});
