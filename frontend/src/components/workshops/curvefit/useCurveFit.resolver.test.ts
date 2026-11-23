// Curve fit reads its rows through the shared resolver (lib/analysisInputs) and
// reports the resolver's reason when it refuses.
import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as analysisInputs from "../../../lib/analysisInputs";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import { fetchBookData, fitModel } from "../../../lib/api";
import { listFitModels } from "../../../lib/api/curvefit";
import type { DataStruct } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { useCurveFit } from "./useCurveFit";

vi.mock("../../../lib/api", () => ({ fitModel: vi.fn(), fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/curvefit", () => ({ autoGuess: vi.fn(), listFitModels: vi.fn(), bootstrapFit: vi.fn() }));
vi.mock("../../../lib/api/figures", () => ({ exportCornerFigure: vi.fn() }));
vi.mock("../../../lib/analysisInputs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/analysisInputs")>();
  return { ...actual, resolveAnalysisInputs: vi.fn((request: Parameters<typeof actual.resolveAnalysisInputs>[0]) => actual.resolveAnalysisInputs(request)) };
});

const DATA: DataStruct = {
  time: [0, 1, 2, 3], values: [[10], [20], [30], [40]], labels: ["y"], units: [""], metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({ models: [] });
  vi.mocked(fetchBookData).mockReset();
  useAnalysisSelection.setState({ toolId: null, selection: null });
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1",
    xKey: null, yKeys: null, seriesOrder: null, errKeys: {}, analysisResults: [], fitOverlay: null, status: "",
  });
});

describe("useCurveFit on the shared resolver", () => {
  it("fits the rows the resolver returns (a bypass fails the spy)", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA, excludedRows: [1] }] });
    vi.mocked(fitModel).mockResolvedValue({ params: [1], yFit: [11, 31, 41] });
    const { result } = renderHook(() => useCurveFit());
    vi.mocked(analysisInputs.resolveAnalysisInputs).mockClear();
    await act(async () => result.current.run("fit"));
    expect(analysisInputs.resolveAnalysisInputs).toHaveBeenCalled();
    expect(fitModel).toHaveBeenCalledWith(expect.objectContaining({ x: [0, 2, 3], y: [10, 30, 40] }));
  });

  it("an empty explicit row selection refuses with the resolver's reason and never fits", async () => {
    const dataset = { id: "d1", name: "run.dat", data: DATA };
    const captured = captureAnalysisSelection({
      datasets: [dataset], activeId: "d1", selectedIds: ["d1"], xKey: null, yKeys: [0],
      seriesOrder: null, errKeys: {}, selection: { datasetId: "d1", rows: [1] }, range: null,
    }, "analysis-center");
    useAnalysisSelection.setState({
      toolId: "curvefit",
      selection: { ...captured, items: captured.items.map((item) => ({ ...item, rowIds: [] })) },
    });
    const { result } = renderHook(() => useCurveFit());
    await act(async () => result.current.run("fit"));
    await waitFor(() => expect(result.current.error ?? "").toMatch(/row selection is empty/));
    expect(fitModel).not.toHaveBeenCalled();
  });

  it("every row excluded refuses with the resolver's reason and never fits", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA, excludedRows: [0, 1, 2, 3] }] });
    const { result } = renderHook(() => useCurveFit());
    await act(async () => result.current.run("fit"));
    await waitFor(() => expect(result.current.error ?? "").toMatch(/No rows remain/));
    expect(fitModel).not.toHaveBeenCalled();
  });
});
