// F4.2c (a) wiring: the spatial grid reads the app-wide "Excluded rows" mode
// and hands it to each panel's fetch (`spatialPanelFetch.ts`), so a toggle
// redraws every panel. uPlot is mocked to a recorder, as in
// MultiPanelStage.test.tsx; the waits are on the recorded panels (state).

import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { spatialComposition } from "../../lib/composition";
import { useApp } from "../../store/useApp";
import MultiPanelStage from "./MultiPanelStage";

const { created, MockUPlot } = vi.hoisted(() => {
  const created: { data: unknown[][] }[] = [];
  class MockUPlot {
    scales = { x: { min: 0, max: 1 } };
    constructor(_opts: unknown, data: unknown[][]) {
      created.push({ data });
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

const COMPOSITION = spatialComposition([
  { datasetId: "d1", xKey: null, yKeys: [0], xLim: [0, 2], yLim: [1, 3], xLog: false, yLog: false, row: 0, col: 0 },
]);

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  useApp.setState({
    datasets: [
      {
        id: "d1",
        name: "book",
        data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["signal"], units: [""], metadata: {} },
        excludedRows: [1],
      },
    ],
    activeId: "d1",
    composition: COMPOSITION,
  });
  useApp.getState().setPref("excludedDisplay", "grey");
});

afterEach(() => {
  vi.unstubAllGlobals();
  useApp.setState({ composition: null });
});

describe("spatial grid follows the Excluded rows mode", () => {
  it("greys the excluded row, then hides it after the toggle", async () => {
    render(<MultiPanelStage composition={COMPOSITION} />);
    await waitFor(() => expect(created.at(-1)?.data).toHaveLength(3));
    expect(created.at(-1)?.data.slice(1)).toEqual([
      [1, null, 3],
      [null, 2, null],
    ]);

    act(() => useApp.getState().setPref("excludedDisplay", "hide"));
    await waitFor(() => expect(created.at(-1)?.data).toHaveLength(2));
    expect(created.at(-1)?.data[1]).toEqual([1, null, 3]);
  });
});
