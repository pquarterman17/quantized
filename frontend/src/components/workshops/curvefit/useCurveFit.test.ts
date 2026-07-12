import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  autoGuess,
  bootstrapFit,
  exportCornerFigure,
  fetchBookData,
  fitModel,
  listFitModels,
} from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useCurveFit } from "./useCurveFit";

vi.mock("../../../lib/api", () => ({
  autoGuess: vi.fn(),
  fitModel: vi.fn(),
  listFitModels: vi.fn(),
  bootstrapFit: vi.fn(),
  exportCornerFigure: vi.fn(),
  fetchBookData: vi.fn(),
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
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
    fitOverlay: null,
  });
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

  it("fits the primary plotted X/Y channels instead of time/values[0]", async () => {
    const multi: DataStruct = {
      time: [0, 1, 2, 3],
      values: [[100, 10, 5], [200, 20, 6], [300, 30, 7], [400, 40, 8]],
      labels: ["field", "moment", "aux"],
      units: ["Oe", "emu", ""],
      metadata: {},
    };
    useApp.setState({
      datasets: [{ id: "d1", name: "loop.dat", data: multi }],
      activeId: "d1",
      xKey: 0,
      yKeys: [2, 1],
      seriesOrder: [1, 2],
      fitOverlay: null,
    });
    vi.mocked(fitModel).mockResolvedValue({ params: [1], yFit: [11, 21, 31, 41] });
    const { result } = renderHook(() => useCurveFit());
    await act(async () => {
      await result.current.run("fit");
    });
    expect(fitModel).toHaveBeenCalledWith({
      model: "Linear",
      x: [100, 200, 300, 400],
      y: [10, 20, 30, 40],
    });
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

  it("resolves a still-pending active dataset before fitting (#38)", async () => {
    const full: DataStruct = {
      time: [0, 1, 2, 3, 4],
      values: [[10], [20], [30], [40], [50]],
      labels: ["y"],
      units: [""],
      metadata: {},
    };
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "book.opj",
          data: { time: [0, 1], values: [[10], [20]], labels: ["y"], units: [""], metadata: {} },
          pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 5, cols: 1 },
        },
      ],
      activeId: "d1",
      fitOverlay: null,
    });
    vi.mocked(fetchBookData).mockResolvedValue(full);
    vi.mocked(fitModel).mockResolvedValue({ params: [1], yFit: [11, 21, 31, 41, 51] });
    const { result } = renderHook(() => useCurveFit());

    await act(async () => {
      await result.current.run("fit");
    });

    expect(fitModel).toHaveBeenCalledWith({ model: "Linear", x: full.time, y: [10, 20, 30, 40, 50] });
    expect(useApp.getState().datasets[0].pending).toBeUndefined();
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "d1", y: [11, 21, 31, 41, 51] });
  });

  it("a pending-resolve failure aborts the fit without calling fitModel", async () => {
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "book.opj",
          data: { time: [0, 1], values: [[10], [20]], labels: ["y"], units: [""], metadata: {} },
          pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 5, cols: 1 },
        },
      ],
      activeId: "d1",
      fitOverlay: null,
    });
    vi.mocked(fetchBookData).mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useCurveFit());

    await act(async () => {
      await result.current.run("fit");
    });

    expect(fitModel).not.toHaveBeenCalled();
    expect(result.current.error).toContain("network down");
    expect(useApp.getState().datasets[0].pending).toBeDefined(); // retryable
  });
});

describe("useCurveFit corner plot (gap #29 UI leg)", () => {
  it("is a no-op with no fit result yet", async () => {
    const { result } = renderHook(() => useCurveFit());
    await act(async () => {
      await result.current.runCornerPlot();
    });
    expect(bootstrapFit).not.toHaveBeenCalled();
  });

  it("is a no-op after an auto-guess (guessOnly) — no completed fit to bootstrap", async () => {
    vi.mocked(autoGuess).mockResolvedValue({ p0: [1] });
    const { result } = renderHook(() => useCurveFit());
    await act(async () => {
      await result.current.run("guess");
    });
    await act(async () => {
      await result.current.runCornerPlot();
    });
    expect(bootstrapFit).not.toHaveBeenCalled();
  });

  it("bootstraps with return_samples then exports the corner figure with the fit's params as truths", async () => {
    vi.mocked(fitModel).mockResolvedValue({ params: [2, 5], yFit: [10, 20, 30, 40] });
    vi.mocked(bootstrapFit).mockResolvedValue({
      params: [2, 5],
      boot_mean: [2, 5],
      boot_se: [0.1, 0.2],
      ciLow: [1.8, 4.6],
      ciHigh: [2.2, 5.4],
      n_boot: 500,
      n_failed: 0,
      boot_samples: [
        [1.9, 4.9],
        [2.1, 5.1],
      ],
    });
    const { result } = renderHook(() => useCurveFit());
    await act(async () => {
      await result.current.run("fit");
    });
    await act(async () => {
      await result.current.runCornerPlot();
    });
    expect(bootstrapFit).toHaveBeenCalledWith({
      model: "Linear",
      x: [0, 1, 2, 3],
      y: [10, 20, 30, 40],
      p0: [2, 5],
      return_samples: true,
    });
    expect(exportCornerFigure).toHaveBeenCalledWith(
      expect.objectContaining({
        samples: [
          [1.9, 4.9],
          [2.1, 5.1],
        ],
        truths: [2, 5],
        filename: "run-corner",
      }),
    );
    expect(result.current.error).toBeNull();
  });

  it("surfaces a bootstrap failure as an error instead of throwing", async () => {
    vi.mocked(fitModel).mockResolvedValue({ params: [2, 5], yFit: [10, 20, 30, 40] });
    vi.mocked(bootstrapFit).mockRejectedValue(new Error("bootstrap unstable"));
    const { result } = renderHook(() => useCurveFit());
    await act(async () => {
      await result.current.run("fit");
    });
    await act(async () => {
      await result.current.runCornerPlot();
    });
    expect(exportCornerFigure).not.toHaveBeenCalled();
    expect(result.current.error).toBe("bootstrap unstable");
    expect(result.current.cornerBusy).toBe(false);
  });
});
