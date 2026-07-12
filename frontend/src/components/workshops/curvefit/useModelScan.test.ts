// AICc model quick-scan hook (GOTO #6): posts the analysis rows (#50/#53)
// with saved custom models as equation candidates, surfaces backend errors,
// and clear() drops the results.

import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { scanFitModels, type ScanEntry } from "../../../lib/api";
import { saveCustomModel } from "../../../lib/fitmodels";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useModelScan } from "./useModelScan";

vi.mock("../../../lib/api", () => ({
  scanFitModels: vi.fn(),
  fetchBookData: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[10], [20], [30], [40]],
  labels: ["y"],
  units: [""],
  metadata: {},
};

const ENTRY: ScanEntry = {
  name: "Linear",
  kind: "registry",
  error: null,
  k: 2,
  params: [10, 10],
  paramNames: ["m", "b"],
  R2: 0.999,
  RMSE: 0.1,
  AIC: -20,
  AICc: -19,
  deltaAICc: 0,
  weight: 0.9,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
  });
});

describe("useModelScan", () => {
  it("scans the analysis rows (#50/#53) and stores the ranked results", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "run.dat", data: DATA, excludedRows: [1] }],
      activeId: "d1",
    });
    vi.mocked(scanFitModels).mockResolvedValue({ n: 3, nCandidates: 1, results: [ENTRY] });
    const { result } = renderHook(() => useModelScan());
    await act(async () => {
      await result.current.scan();
    });
    // Excluded row 1 is pruned; no saved custom models -> no `equations` key.
    expect(scanFitModels).toHaveBeenCalledWith({ x: [0, 2, 3], y: [10, 30, 40] });
    expect(result.current.results).toEqual([ENTRY]);
    expect(result.current.error).toBeNull();
  });

  it("scans the primary plotted X/Y channels instead of time/values[0]", async () => {
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
    });
    vi.mocked(scanFitModels).mockResolvedValue({ n: 4, nCandidates: 1, results: [ENTRY] });
    const { result } = renderHook(() => useModelScan());
    await act(async () => {
      await result.current.scan();
    });
    // plot X = field (channel 0); primary Y after ordering = moment (channel 1).
    expect(scanFitModels).toHaveBeenCalledWith({ x: [100, 200, 300, 400], y: [10, 20, 30, 40] });
  });

  it("includes saved custom equation models as scan candidates", async () => {
    saveCustomModel({
      version: 1,
      name: "MyDecay",
      equation: "a*exp(-x/t)",
      params: ["a", "t"],
      guesses: [2.5, 1],
      lower: [null, null],
      upper: [null, null],
    });
    vi.mocked(scanFitModels).mockResolvedValue({ n: 4, nCandidates: 2, results: [] });
    const { result } = renderHook(() => useModelScan());
    await act(async () => {
      await result.current.scan();
    });
    expect(scanFitModels).toHaveBeenCalledWith({
      x: [0, 1, 2, 3],
      y: [10, 20, 30, 40],
      equations: [{ name: "MyDecay", equation: "a*exp(-x/t)", guesses: [2.5, 1] }],
    });
  });

  it("surfaces a backend failure as an error and clears busy", async () => {
    vi.mocked(scanFitModels).mockRejectedValue(new Error("need at least 3 points"));
    const { result } = renderHook(() => useModelScan());
    await act(async () => {
      await result.current.scan();
    });
    expect(result.current.error).toContain("at least 3 points");
    expect(result.current.busy).toBe(false);
    expect(result.current.results).toBeNull();
  });

  it("does nothing without an active dataset", async () => {
    useApp.setState({ datasets: [], activeId: null });
    const { result } = renderHook(() => useModelScan());
    await waitFor(() => expect(result.current.hasDataset).toBe(false));
    await act(async () => {
      await result.current.scan();
    });
    expect(scanFitModels).not.toHaveBeenCalled();
  });

  it("clear drops results and error", async () => {
    vi.mocked(scanFitModels).mockResolvedValue({ n: 4, nCandidates: 1, results: [ENTRY] });
    const { result } = renderHook(() => useModelScan());
    await act(async () => {
      await result.current.scan();
    });
    expect(result.current.results).not.toBeNull();
    act(() => {
      result.current.clear();
    });
    expect(result.current.results).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
