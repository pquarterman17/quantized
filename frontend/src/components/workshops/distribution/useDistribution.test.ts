import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type DistFitAllResponse,
  statsDescriptive,
  statsFitDistributions,
  statsHistogram,
  statsShapiro,
} from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useDistribution } from "./useDistribution";

vi.mock("../../../lib/api", () => ({
  statsHistogram: vi.fn(),
  statsDescriptive: vi.fn(),
  statsShapiro: vi.fn(),
  statsFitDistributions: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[10], [20], [30], [40], [50], [60]],
  labels: ["v"],
  units: [""],
  metadata: { x_column_name: "T" },
};

const HIST = { counts: [2, 2, 2], centers: [15, 35, 55], edges: [10, 30, 50, 70], n_bins: 3, n: 6 };
const DESC = { N: 6, mean: 35, median: 35, std: 18.7, min: 10, max: 60, q1: 20, q3: 50 };
const NORM = { W: 0.95, p: 0.7, N: 6 };
const FITS: DistFitAllResponse = {
  fits: [
    { dist: "normal", params: { mu: 35, sigma: 18.7 }, loglike: -10, aic: 24, n_params: 2, ks_d: 0.1, ks_p: 0.9, ks_p_approximate: true, N: 6 },
    { dist: "gamma", params: { shape: 2, scale: 17.5 }, loglike: -11, aic: 26, n_params: 2, ks_d: 0.2, ks_p: 0.4, ks_p_approximate: true, N: 6 },
  ],
  best: "normal",
  skipped: [{ dist: "lognormal", reason: "requires strictly positive data" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(statsHistogram).mockResolvedValue(HIST);
  vi.mocked(statsDescriptive).mockResolvedValue(DESC);
  vi.mocked(statsShapiro).mockResolvedValue(NORM);
  vi.mocked(statsFitDistributions).mockResolvedValue(FITS);
  useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1", selection: null });
});

describe("useDistribution", () => {
  it("profiles the default column: histogram + stats + normality", async () => {
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.hist).not.toBeNull());
    expect(statsHistogram).toHaveBeenCalledWith([10, 20, 30, 40, 50, 60]);
    expect(result.current.hist!.counts).toEqual([2, 2, 2]);
    expect(result.current.desc).toEqual(DESC);
    expect(result.current.norm).toEqual({ W: 0.95, p: 0.7, N: 6 });
    expect(result.current.label).toBe("v");
  });

  it("honors row exclusion (#50): excluded rows drop from the profiled column", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "run.dat", data: DATA, excludedRows: [0, 1] }],
      activeId: "d1",
    });
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(statsHistogram).toHaveBeenCalled());
    expect(statsHistogram).toHaveBeenCalledWith([30, 40, 50, 60]);
    expect(result.current).toBeTruthy();
  });

  it("keeps histogram + stats when the normality test fails", async () => {
    vi.mocked(statsShapiro).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.hist).not.toBeNull());
    expect(result.current.norm).toBeNull();
    expect(result.current.normNote).toBe("normality test unavailable");
    expect(result.current.desc).toEqual(DESC); // survived
  });

  it("surfaces a bin error when the column is too sparse", async () => {
    vi.mocked(statsHistogram).mockRejectedValue(new Error("needs 2 finite"));
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.hist).toBeNull();
    expect(result.current.error).toContain("too few");
  });

  it("re-profiles when the selected column changes (x here)", async () => {
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.hist).not.toBeNull());
    act(() => result.current.setCol(-1));
    await waitFor(() => expect(statsHistogram).toHaveBeenLastCalledWith([0, 1, 2, 3, 4, 5]));
    expect(result.current.label).toBe("T");
  });
});

describe("useDistribution — distribution-fit overlay (item 6b)", () => {
  it("does not fetch fits until a family is picked", async () => {
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.hist).not.toBeNull());
    expect(statsFitDistributions).not.toHaveBeenCalled();
    expect(result.current.fitCurve).toBeNull();
  });

  it("fetches all families once picked and exposes current/best/curve", async () => {
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.hist).not.toBeNull());
    act(() => result.current.setFitDist("normal"));
    await waitFor(() => expect(statsFitDistributions).toHaveBeenCalledWith([10, 20, 30, 40, 50, 60]));
    await waitFor(() => expect(result.current.currentFit).not.toBeNull());
    expect(result.current.currentFit!.dist).toBe("normal");
    expect(result.current.currentFit!.aic).toBe(24);
    expect(result.current.bestFit!.dist).toBe("normal"); // fits[0] is AIC-best
    expect(result.current.fitCurve).not.toBeNull();
    expect(result.current.fitCurve!.x.length).toBeGreaterThan(1);
  });

  it("switching to a family the panel already fetched re-fits (simple, no stale cache)", async () => {
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.hist).not.toBeNull());
    act(() => result.current.setFitDist("normal"));
    await waitFor(() => expect(result.current.currentFit?.dist).toBe("normal"));
    act(() => result.current.setFitDist("gamma"));
    await waitFor(() => expect(result.current.currentFit?.dist).toBe("gamma"));
    expect(result.current.currentFit!.aic).toBe(26);
    // AIC-best is still "normal" regardless of the pick.
    expect(result.current.bestFit!.dist).toBe("normal");
  });

  it("surfaces the skipped reason when the picked family can't be fit for this column", async () => {
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.hist).not.toBeNull());
    act(() => result.current.setFitDist("lognormal"));
    await waitFor(() => expect(statsFitDistributions).toHaveBeenCalled());
    await waitFor(() => expect(result.current.skippedReason).not.toBeNull());
    expect(result.current.skippedReason).toContain("positive");
    expect(result.current.currentFit).toBeNull();
  });

  it("clears the fit state when switched back to none", async () => {
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.hist).not.toBeNull());
    act(() => result.current.setFitDist("normal"));
    await waitFor(() => expect(result.current.currentFit).not.toBeNull());
    act(() => result.current.setFitDist("none"));
    await waitFor(() => expect(result.current.fits).toBeNull());
    expect(result.current.fitCurve).toBeNull();
  });

  it("surfaces a fetch error without leaving stale fit state", async () => {
    vi.mocked(statsFitDistributions).mockRejectedValue(new Error("fit endpoint down"));
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.hist).not.toBeNull());
    act(() => result.current.setFitDist("normal"));
    await waitFor(() => expect(result.current.fitError).not.toBeNull());
    expect(result.current.fitError).toContain("fit endpoint down");
    expect(result.current.fits).toBeNull();
  });
});

describe("useDistribution — histogram bar brushing (item 6c)", () => {
  // column "v" = [10,20,30,40,50,60]; edges = [10,30,50,70] (bins: [10,30),[30,50),[50,70]).
  it("brushing a bin writes the shared #50 selection mapped to original rows", async () => {
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.hist).not.toBeNull());
    act(() => result.current.brushBins(0, 0, false)); // bin 0: values 10,20 -> rows 0,1
    expect(useApp.getState().selection).toEqual({ datasetId: "d1", rows: [0, 1] });
    expect(result.current.brushedBins).toEqual([0, 0]);
  });

  it("the LAST bin is inclusive on the high end", async () => {
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.hist).not.toBeNull());
    act(() => result.current.brushBins(2, 2, false)); // last bin [50,70] -> rows 4,5 (60 included)
    expect(useApp.getState().selection).toEqual({ datasetId: "d1", rows: [4, 5] });
  });

  it("brushing the exact same bin again clears the selection", async () => {
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.hist).not.toBeNull());
    act(() => result.current.brushBins(1, 1, false));
    expect(useApp.getState().selection).not.toBeNull();
    act(() => result.current.brushBins(1, 1, false));
    expect(useApp.getState().selection).toBeNull();
    expect(result.current.brushedBins).toBeNull();
  });

  it("shift-click extends the brush range from the last anchor", async () => {
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.hist).not.toBeNull());
    act(() => result.current.brushBins(0, 0, false)); // anchor = bin 0
    act(() => result.current.brushBins(2, 2, true)); // shift-extend to bin 2 -> spans 0..2 (all rows)
    expect(result.current.brushedBins).toEqual([0, 2]);
    expect(useApp.getState().selection).toEqual({ datasetId: "d1", rows: [0, 1, 2, 3, 4, 5] });
  });

  it("dragging across bars brushes the spanned range directly", async () => {
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.hist).not.toBeNull());
    act(() => result.current.brushBins(0, 1, false)); // drag from bin 0 to bin 1
    expect(result.current.brushedBins).toEqual([0, 1]);
    expect(useApp.getState().selection).toEqual({ datasetId: "d1", rows: [0, 1, 2, 3] });
  });

  it("honors exclusion (#50): brushed rows expand back through the kept-index map", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "run.dat", data: DATA, excludedRows: [0] }],
      activeId: "d1",
      selection: null,
    });
    const { result } = renderHook(() => useDistribution());
    // analysis column drops row 0 (value 10); pruned column = [20,30,40,50,60]
    await waitFor(() => expect(statsHistogram).toHaveBeenCalledWith([20, 30, 40, 50, 60]));
    await waitFor(() => expect(result.current.hist).not.toBeNull());
    // bin 0 = [10,30): only pruned value 20 (pruned index 0) -> original row 1
    act(() => result.current.brushBins(0, 0, false));
    expect(useApp.getState().selection).toEqual({ datasetId: "d1", rows: [1] });
  });

  it("resets brush tracking (not the shared selection) when the column changes", async () => {
    const { result } = renderHook(() => useDistribution());
    await waitFor(() => expect(result.current.hist).not.toBeNull());
    act(() => result.current.brushBins(0, 0, false));
    expect(result.current.brushedBins).not.toBeNull();
    act(() => result.current.setCol(-1));
    expect(result.current.brushedBins).toBeNull();
    // the store selection itself is left alone for other views
    expect(useApp.getState().selection).not.toBeNull();
  });
});
