// The window layout re-labels a pinnable tool's live selection as a frozen
// "plot" capture for the length of a run (store/layoutToolActions). Peaks must
// read the same range in that state: the rows it analyses are the rows the
// input line states (acceptance defect D1 hit Curve Fit; this pins Peaks).
import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import { findPeaks } from "../../../lib/api/peaks";
import type { DataStruct } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { toolBusyChanged } from "../../../store/layoutToolActions";
import { registerLayoutTool, resetLayoutToolsForTests } from "../../../store/layoutTools";
import { useApp } from "../../../store/useApp";
import { usePeaks } from "./usePeaks";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/peaks", () => ({ findPeaks: vi.fn(), fitMultiPeak: vi.fn(), fitPeak: vi.fn() }));
vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5], values: [[1], [5], [2], [6], [2], [1]], labels: ["I"], units: ["cps"], metadata: {},
};
const DS = { id: "d1", name: "x.dat", data: DATA };

beforeEach(() => {
  vi.clearAllMocks();
  resetLayoutToolsForTests();
  vi.mocked(findPeaks).mockResolvedValue({ peaks: [], background: [] });
  useApp.setState({
    datasets: [DS], activeId: "d1", xKey: null, yKeys: [0], seriesOrder: null, peakOverlay: null,
    annotations: [], history: [], future: [], historySuppressed: false, xLim: null, yLim: null, yScale: "linear",
  });
});

describe("Peaks under the run's auto-pin", () => {
  it("analyses the range the frozen selection holds", async () => {
    const live = captureAnalysisSelection({
      datasets: [DS], activeId: "d1", selectedIds: ["d1"], xKey: null, yKeys: [0], seriesOrder: null, errKeys: {},
      selection: null, range: { lo: 1, hi: 4, source: "integration region" },
    }, "tool-default");
    useAnalysisSelection.setState({ toolId: "peaks", selection: live });
    registerLayoutTool({ id: "peaks", title: "Peaks", width: 300, head: null, body: document.createElement("div"), busy: false, pinRestored: true, autoPin: null });
    act(() => { toolBusyChanged("peaks", true); }); // the host, as the run starts
    expect(useAnalysisSelection.getState().selection?.source).toBe("plot");
    renderHook(() => usePeaks());
    await waitFor(() => expect(vi.mocked(findPeaks).mock.calls.length).toBeGreaterThan(0));
    expect(findPeaks).toHaveBeenLastCalledWith({ x: [1, 2, 3, 4], y: [5, 2, 6, 2] });
  });
});
