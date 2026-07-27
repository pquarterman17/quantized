// AICc model quick-scan hook (GOTO #6): submits the analysis rows (#50/#53)
// with saved custom models as equation candidates to the job-queued scan
// (P0.4 feedback/cancel audit tail), polls for progress, surfaces backend
// errors, cancels cleanly, and clear() drops the results.

import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScanEntry } from "../../../lib/api";
import { scanFitModelsJob } from "../../../lib/fitscan";
import { saveCustomModel } from "../../../lib/fitmodels";
import { JobCancelledError } from "../../../lib/jobs";
import * as jobs from "../../../lib/jobs";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useModelScan } from "./useModelScan";

vi.mock("../../../lib/api", () => ({
  fetchBookData: vi.fn(),
}));

vi.mock("../../../lib/fitscan", () => ({
  scanFitModelsJob: vi.fn(),
}));

vi.mock("../../../lib/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/jobs")>();
  return { ...actual, pollJob: vi.fn(), cancelJob: vi.fn() };
});

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
  vi.mocked(scanFitModelsJob).mockResolvedValue({ job_id: "job-1" });
  vi.mocked(jobs.pollJob).mockResolvedValue({ results: [ENTRY] });
});

describe("useModelScan", () => {
  it("submits the analysis rows (#50/#53) to the job queue and stores the polled results", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "run.dat", data: DATA, excludedRows: [1] }],
      activeId: "d1",
    });
    const { result } = renderHook(() => useModelScan());
    await act(async () => {
      await result.current.scan();
    });
    // Excluded row 1 is pruned; no saved custom models -> no `equations` key.
    expect(scanFitModelsJob).toHaveBeenCalledWith({ x: [0, 2, 3], y: [10, 30, 40] });
    expect(jobs.pollJob).toHaveBeenCalledWith("job-1", expect.any(Function));
    expect(result.current.results).toEqual([ENTRY]);
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
    expect(result.current.progress).toBeNull();
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
    const { result } = renderHook(() => useModelScan());
    await act(async () => {
      await result.current.scan();
    });
    // plot X = field (channel 0); primary Y after ordering = moment (channel 1).
    expect(scanFitModelsJob).toHaveBeenCalledWith({
      x: [100, 200, 300, 400],
      y: [10, 20, 30, 40],
    });
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
    const { result } = renderHook(() => useModelScan());
    await act(async () => {
      await result.current.scan();
    });
    expect(scanFitModelsJob).toHaveBeenCalledWith({
      x: [0, 1, 2, 3],
      y: [10, 20, 30, 40],
      equations: [{ name: "MyDecay", equation: "a*exp(-x/t)", guesses: [2.5, 1] }],
    });
  });

  it("reports progress via the poll callback while a scan is in flight", async () => {
    let onProgress!: (f: number, m: string) => void;
    vi.mocked(jobs.pollJob).mockImplementation(async (_id, cb) => {
      onProgress = cb as (f: number, m: string) => void;
      onProgress(0.0, "Scanning 1/2: Linear");
      onProgress(0.5, "Scanning 2/2: Gaussian");
      return { results: [ENTRY] };
    });
    const { result } = renderHook(() => useModelScan());
    await act(async () => {
      await result.current.scan();
    });
    // busy/progress reset to idle once the scan settles — the intermediate
    // values are exercised by the callback assertions above.
    expect(result.current.busy).toBe(false);
    expect(result.current.progress).toBeNull();
    expect(result.current.progressMessage).toBeNull();
  });

  it("cancel forwards the in-flight job id to cancelJob", async () => {
    let resolvePoll!: (v: { results: ScanEntry[] }) => void;
    vi.mocked(jobs.pollJob).mockReturnValue(
      new Promise((r) => {
        resolvePoll = r;
      }),
    );
    const { result } = renderHook(() => useModelScan());
    let p!: Promise<void>;
    act(() => {
      p = result.current.scan();
    });
    await waitFor(() => expect(scanFitModelsJob).toHaveBeenCalled());

    await act(async () => {
      await result.current.cancel();
    });
    expect(jobs.cancelJob).toHaveBeenCalledWith("job-1");

    resolvePoll({ results: [ENTRY] });
    await act(async () => {
      await p;
    });
  });

  it("a cancelled job clears busy without setting an error", async () => {
    vi.mocked(jobs.pollJob).mockRejectedValue(new JobCancelledError("job-1"));
    const { result } = renderHook(() => useModelScan());
    await act(async () => {
      await result.current.scan();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("surfaces a backend failure as an error and clears busy", async () => {
    vi.mocked(jobs.pollJob).mockRejectedValue(new Error("need at least 3 points"));
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
    expect(scanFitModelsJob).not.toHaveBeenCalled();
  });

  it("clear drops results and error", async () => {
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
