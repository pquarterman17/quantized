// Regression coverage for MultiPanelStage's FOUR render modes (plain stack,
// spatial-apply, facet-by-column, paneled x-breaks — gap #21's last
// residual). Real uPlot needs a browser canvas/layout engine neither jsdom
// nor this test cares about; the constructor is mocked to a lightweight
// recorder so the render effect (the thing actually under test — did the
// right NUMBER of panels get built, without throwing) can run headlessly.
// jsdom also has no ResizeObserver, so it's stubbed too.

import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";
import MultiPanelStage from "./MultiPanelStage";

// vi.mock's factory is hoisted above imports, so the recorder + mock class
// must be created through vi.hoisted rather than referenced as plain
// module-scope variables (they'd otherwise be "used before initialization").
const { created, MockUPlot } = vi.hoisted(() => {
  const created: unknown[] = [];
  class MockUPlot {
    scales = { x: { min: 0, max: 1 } };
    constructor(opts: unknown, data: unknown) {
      created.push({ opts, data });
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

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [
    [10, 100],
    [20, 200],
    [30, 300],
    [40, 400],
  ],
  labels: ["a", "b"],
  units: ["", ""],
  metadata: {},
};

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  useApp.setState({
    datasets: [{ id: "d1", name: "ds1", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    y2Keys: null,
    seriesOrder: null,
    stackMode: true,
    spatialPanels: null,
    facetPanels: null,
    breakPanels: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MultiPanelStage — mode regressions", () => {
  it("plain per-channel stack mode renders without throwing", async () => {
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBeGreaterThan(0));
    // Both channels (a, b) plot by default -> one panel each.
    expect(created).toHaveLength(2);
  });

  it("facet-by-column mode still renders (regression)", async () => {
    useApp.getState().facetByColumn("d1", 0);
    const expected = useApp.getState().facetPanels?.length ?? 0;
    expect(expected).toBeGreaterThan(0);
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(expected));
  });

  it("spatial-apply mode still renders (regression)", async () => {
    useApp.setState({
      spatialPanels: [
        {
          datasetId: "d1",
          xKey: null,
          yKeys: [0],
          xLim: [0, 3],
          yLim: [0, 40],
          xLog: false,
          yLog: false,
          row: 0,
          col: 0,
        },
      ],
    });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(1));
  });

  it("paneled x-break mode renders one uPlot per segment (gap #21 residual)", async () => {
    useApp.getState().breakAtGaps("d1", [[1, 2]]);
    const expected = useApp.getState().breakPanels?.length ?? 0;
    expect(expected).toBe(2);
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(expected));
  });
});
