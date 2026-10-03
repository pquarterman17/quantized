// Plot audit round 4: a reversed x (IR wavenumber, `xReversed`) drew high-to-
// low on the flat plot and in every export, but the per-channel stack and the
// facet grid drew it ascending — their panels never received the flag.
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";
import MultiPanelStage from "./MultiPanelStage";

type Opts = { scales?: { x?: { dir?: number } } };
const { created, MockUPlot } = vi.hoisted(() => {
  const created: Opts[] = [];
  class MockUPlot {
    scales = { x: { min: 0, max: 1 } };
    constructor(opts: Opts) {
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

const DATA: DataStruct = {
  time: [4000, 3000, 2000, 1000],
  values: [[1, 5, 0], [2, 6, 0], [3, 7, 1], [4, 8, 1]],
  labels: ["A", "B", "level"],
  units: ["", "", ""],
  metadata: {},
};

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  useApp.setState({
    datasets: [{ id: "d1", name: "ir.dx", data: DATA }], activeId: "d1",
    xKey: null, yKeys: [0, 1], y2Keys: null, seriesOrder: null, hiddenChannels: [], composition: null,
    facetKey: null, groupKey: null, seriesStyles: {}, seriesLabels: {}, plotWindows: [], focusedWindowId: null,
    polarMode: false, statMode: false, xReversed: true,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useApp.setState({ stackMode: false, facetKey: null, composition: null, xReversed: false });
});

describe("MultiPanelStage — reversed x", () => {
  it("draws every stack panel high-to-low", async () => {
    useApp.setState({ stackMode: true });
    render(<MultiPanelStage composition={null} />);
    await waitFor(() => expect(created).toHaveLength(2));
    expect(created.map((o) => o.scales?.x?.dir)).toEqual([-1, -1]);
  });

  it("draws every facet panel high-to-low", async () => {
    useApp.setState({ stackMode: true, yKeys: [0] });
    useApp.getState().facetByColumn("d1", 2);
    render(<MultiPanelStage composition={useApp.getState().composition} />);
    await waitFor(() => expect(created).toHaveLength(2));
    expect(created.map((o) => o.scales?.x?.dir)).toEqual([-1, -1]);
  });
});
