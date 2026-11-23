// Peaks (auto-find) reads rows through the shared resolver and reports its reason.
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findPeaks } from "../../../lib/api/peaks";
import type { DataStruct } from "../../../lib/types";
import { usePendingOps } from "../../../store/pendingOps";
import { useToasts } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import * as analysisInputs from "../../../lib/analysisInputs";
import { usePeaks } from "./usePeaks";

vi.mock("../../../lib/api", () => ({
  fetchBookData: vi.fn(),
}));
vi.mock("../../../lib/api/peaks", () => ({
  findPeaks: vi.fn(),
  fitMultiPeak: vi.fn(),
  fitPeak: vi.fn(),
}));
vi.mock("../../overlays/ParamDialog", () => ({
  askParams: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[1], [5], [2], [6], [2], [1]],
  labels: ["I"],
  units: ["cps"],
  metadata: {},
};

vi.mock("../../../lib/analysisInputs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/analysisInputs")>();
  return { ...actual, resolveAnalysisInputs: vi.fn((request: Parameters<typeof actual.resolveAnalysisInputs>[0]) => actual.resolveAnalysisInputs(request)) };
});

const DS = { id: "d1", name: "x.dat", data: DATA };

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  useToasts.setState({ toasts: [] });
  useAnalysisSelection.setState({ toolId: null, selection: null });
  useApp.setState({
    datasets: [DS], activeId: "d1", xKey: null, yKeys: null, seriesOrder: null, peakOverlay: null,
    annotations: [], history: [], future: [], historySuppressed: false, xLim: null, yLim: null, yScale: "linear",
  });
  vi.mocked(findPeaks).mockResolvedValue({ peaks: [], background: [] });
});

function emptySelection(): void {
  const captured = captureAnalysisSelection({
    datasets: [DS], activeId: "d1", selectedIds: ["d1"], xKey: null, yKeys: [0],
    seriesOrder: null, errKeys: {}, selection: { datasetId: "d1", rows: [1] }, range: null,
  }, "analysis-center");
  useAnalysisSelection.setState({
    toolId: "peaks", selection: { ...captured, items: captured.items.map((item) => ({ ...item, rowIds: [] })) },
  });
}

describe("usePeaks on the shared resolver", () => {
  it("auto-find reads rows through resolveAnalysisInputs", async () => {
    vi.mocked(analysisInputs.resolveAnalysisInputs).mockClear();
    vi.mocked(findPeaks).mockResolvedValue({ peaks: [{ center: 3, height: 6, fwhm: 1, prominence: 1, localSNR: 10, area: null, bg: 0 }], background: [] });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(1));
    expect(findPeaks).toHaveBeenCalledWith({ x: DATA.time, y: [1, 5, 2, 6, 2, 1] });
    expect(analysisInputs.resolveAnalysisInputs).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it("an empty explicit row selection says why and never analyses the whole sheet", async () => {
    emptySelection();
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.error ?? "").toMatch(/row selection is empty/));
    expect(findPeaks).not.toHaveBeenCalled();
  });

  it("every row excluded says why", async () => {
    useApp.setState({ datasets: [{ ...DS, excludedRows: [0, 1, 2, 3, 4, 5] }] });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.error ?? "").toMatch(/No rows remain/));
    expect(findPeaks).not.toHaveBeenCalled();
  });
});
