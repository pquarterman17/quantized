import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { autoGuess, fitModel, listFitModels } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useCurveFit } from "./useCurveFit";

vi.mock("../../../lib/api", () => ({
  autoGuess: vi.fn(),
  fitModel: vi.fn(),
  listFitModels: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[10], [20], [30], [40]],
  labels: ["y"],
  units: [""],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({ models: [] });
  useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1", fitOverlay: null });
});

describe("useCurveFit exclusion honoring (#50/#53)", () => {
  it("fits the FULL data and overlays it 1:1 when nothing is excluded", async () => {
    vi.mocked(fitModel).mockResolvedValue({ params: [1], yFit: [11, 21, 31, 41] });
    const { result } = renderHook(() => useCurveFit());
    await act(async () => {
      await result.current.run("fit");
    });
    expect(fitModel).toHaveBeenCalledWith({ model: "Linear", x: [0, 1, 2, 3], y: [10, 20, 30, 40] });
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "d1", y: [11, 21, 31, 41] });
  });

  it("fits only the kept rows and expands the overlay back to full length (row 1 excluded)", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "run.dat", data: DATA, excludedRows: [1] }],
      activeId: "d1",
      fitOverlay: null,
    });
    // fit receives the pruned x/y → returns a pruned-length yFit
    vi.mocked(fitModel).mockResolvedValue({ params: [1], yFit: [11, 31, 41] });
    const { result } = renderHook(() => useCurveFit());
    await act(async () => {
      await result.current.run("fit");
    });
    // excluded row 1 dropped from the fit inputs
    expect(fitModel).toHaveBeenCalledWith({ model: "Linear", x: [0, 2, 3], y: [10, 30, 40] });
    // overlay expanded to full length with a null gap at the excluded row
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "d1", y: [11, null, 31, 41] });
  });

  it("also honors the local filter (#53) in the fit inputs", async () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "run.dat", data: DATA, filter: [{ col: 0, kind: "range", min: 25 }] },
      ],
      activeId: "d1",
      fitOverlay: null,
    });
    vi.mocked(fitModel).mockResolvedValue({ params: [1], yFit: [31, 41] });
    const { result } = renderHook(() => useCurveFit());
    await act(async () => {
      await result.current.run("fit");
    });
    // keep values ≥ 25 → rows 2,3 (x = 2,3; y = 30,40)
    expect(fitModel).toHaveBeenCalledWith({ model: "Linear", x: [2, 3], y: [30, 40] });
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "d1", y: [null, null, 31, 41] });
  });

  it("auto-guess also runs on the analysis subset", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "run.dat", data: DATA, excludedRows: [0] }],
      activeId: "d1",
    });
    vi.mocked(autoGuess).mockResolvedValue({ p0: [1] });
    const { result } = renderHook(() => useCurveFit());
    await waitFor(() => expect(listFitModels).toHaveBeenCalled());
    await act(async () => {
      await result.current.run("guess");
    });
    expect(autoGuess).toHaveBeenCalledWith("Linear", [1, 2, 3], [20, 30, 40]);
  });
});
