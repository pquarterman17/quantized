// Model scan on the workbench shell's out-of-date pattern (lane WB4). The scan
// stays a button on the poll-model job (own Cancel / StatusBar op), so it uses
// workbench/useRunStamp: the ranking is stamped with the data, channels and
// saved equations it was launched with, and is out of date once they change,
// including a change made while the job ran (forced with a held poll).

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScanEntry } from "../../../lib/api/curvefit";
import { saveCustomModel } from "../../../lib/fitmodels";
import { scanFitModelsJob } from "../../../lib/fitscan";
import * as jobs from "../../../lib/jobs";
import type { DataStruct } from "../../../lib/types";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import { useModelScan } from "./useModelScan";
import { makePending, restoreResolve } from "../workbench/pendingBook.testkit";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn() }));
vi.mock("../../../lib/fitscan", () => ({ scanFitModelsJob: vi.fn() }));
vi.mock("../../../lib/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/jobs")>();
  return { ...actual, pollJob: vi.fn(), cancelJob: vi.fn() };
});

const DATA: DataStruct = {
  time: [0, 1, 2, 3], values: [[10, 1], [20, 2], [30, 3], [40, 4]], labels: ["y", "y2"], units: ["", ""], metadata: {},
};
const ENTRY: ScanEntry = {
  name: "Linear", kind: "registry", error: null, k: 2, params: [10, 10], paramNames: ["m", "b"],
  R2: 0.999, RMSE: 0.1, AIC: -20, AICc: -19, deltaAICc: 0, weight: 0.9,
  adjR2: 0.99, chiSqRed: 0.01, BIC: -18, converged: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  restoreResolve();
  usePendingOps.setState({ ops: [] });
  localStorage.clear();
  useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1", xKey: null, yKeys: [0], seriesOrder: null });
  vi.mocked(scanFitModelsJob).mockResolvedValue({ job_id: "job-1" });
  vi.mocked(jobs.pollJob).mockResolvedValue({ results: [ENTRY] });
});

describe("useModelScan freshness", () => {
  it("a ranking is out of date once the channel, rows or saved equations change; Scan again clears it", async () => {
    const { result, rerender } = renderHook(() => useModelScan());
    await act(() => result.current.scan());
    expect(result.current.stale).toBe(false);

    act(() => useApp.setState({ yKeys: [1] }));
    expect(result.current.stale).toBe(true);
    expect(result.current.results).toEqual([ENTRY]); // still listed, marked
    act(() => useApp.setState({ yKeys: [0] }));
    expect(result.current.stale).toBe(false);

    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [1] })) })));
    expect(result.current.stale).toBe(true);
    await act(() => result.current.scan());
    expect(result.current.stale).toBe(false);

    act(() => { saveCustomModel({ version: 2, name: "sq", equation: "y = a*x^2", params: ["a"], guesses: [1], lower: [null], upper: [null] }); });
    // The saved-equation list is read per render: any re-render sees it.
    rerender();
    expect(result.current.stale).toBe(true);
  });

  it("a rename is not an input change", async () => {
    const { result } = renderHook(() => useModelScan());
    await act(() => result.current.scan());
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, name: "renamed.dat" })) })));
    expect(result.current.stale).toBe(false);
  });

  it("clear forgets the mark with the results", async () => {
    const { result } = renderHook(() => useModelScan());
    await act(() => result.current.scan());
    act(() => useApp.setState({ yKeys: [1] }));
    act(() => result.current.clear());
    expect(result.current.results).toBeNull();
    expect(result.current.stale).toBe(false);
  });

  it("forced race: a channel changed while the job ran leaves the landed ranking out of date", async () => {
    let land!: (v: { results: ScanEntry[] }) => void;
    let began!: () => void;
    const started = new Promise<void>((r) => { began = r; });
    vi.mocked(jobs.pollJob).mockImplementationOnce(() => { began(); return new Promise((r) => { land = r as never; }); });
    const { result } = renderHook(() => useModelScan());
    let p!: Promise<void>;
    act(() => { p = result.current.scan(); });
    await started;
    act(() => useApp.setState({ yKeys: [1] }));
    land({ results: [ENTRY] });
    await act(async () => { await p; });
    expect(result.current.results).toEqual([ENTRY]);
    expect(result.current.stale).toBe(true);
  });

  it("a validation failure is a refusal; a backend failure is not", async () => {
    useApp.setState({ yKeys: [0], datasets: [{ id: "d1", name: "run.dat", data: { ...DATA, values: DATA.values.map(() => [Number.NaN, 1]) } }] });
    const { result } = renderHook(() => useModelScan());
    await act(() => result.current.scan());
    expect(result.current.error).toMatch(/no finite/);
    expect(result.current.refusal).toBe(true);
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }] });
    vi.mocked(jobs.pollJob).mockRejectedValueOnce(new Error("backend down"));
    await act(() => result.current.scan());
    expect(result.current.error).toBe("backend down");
    expect(result.current.refusal).toBe(false);
  });

  it("a lazy book that arrives during the scan does not land the ranking out of date", async () => {
    makePending({ id: "d1", name: "run.dat", data: DATA });
    const { result } = renderHook(() => useModelScan());
    await act(() => result.current.scan());
    expect(result.current.results).toEqual([ENTRY]);
    expect(result.current.stale).toBe(false);
  });
});
