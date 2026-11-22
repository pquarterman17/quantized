// Fit Y by X on the shared input contract (lib/analysisInputs): the leg and the
// By partition read the resolver's analysis view, a lazy Origin preview is
// refused (never computed), and the queued report-after-load still works.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBookData, reportEmit, statsAnova, statsLevene, statsRecommend, statsRegression, statsTukey } from "../../../lib/api";
import { resetBookTransportForTests } from "../../../lib/bookData";
import type { DataStruct, Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useFitYByX } from "./useFitYByX";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsAnova: vi.fn(),
  statsLevene: vi.fn(),
  statsTukey: vi.fn(),
  statsRecommend: vi.fn(),
  statsRegression: vi.fn(),
  reportEmit: vi.fn(),
  fetchBookData: vi.fn(),
}));

// col0 "g" (2-level By column), col1 "x" and col2 "y" continuous. Twelve rows
// so "g" reads nominal; row 0 is excluded.
const FULL: DataStruct = {
  time: Array.from({ length: 12 }, (_, i) => i),
  values: Array.from({ length: 12 }, (_, i) => [i < 6 ? 0 : 1, i * 1.5, i * 3 + (i % 3)]),
  labels: ["g", "x", "y"],
  units: ["", "", ""],
  metadata: {},
};
const PREVIEW: DataStruct = { ...FULL, time: FULL.time.slice(0, 4), values: FULL.values.slice(0, 4) };
const PENDING = { kind: "upload", bookId: "b1", rows: 12, cols: 3, previewSampled: false } as const;
const LAZY: Dataset = { id: "d1", name: "run.dat", data: PREVIEW, pending: PENDING, excludedRows: [0] };
const LOADED: Dataset = { id: "d1", name: "run.dat", data: FULL, excludedRows: [0] };

const KEPT_X = FULL.values.slice(1).map((row) => row[1]);

beforeEach(() => {
  resetBookTransportForTests();
  vi.clearAllMocks();
  vi.mocked(fetchBookData).mockReset().mockReturnValue(new Promise(() => {}));
  vi.mocked(statsRegression).mockResolvedValue({ coeffs: [0, 1], R2: 1, yFit: [], residuals: [] } as never);
  vi.mocked(statsAnova).mockResolvedValue({ fStat: 1, df1: 1, df2: 1, pValue: 0.5, reject: false } as never);
  vi.mocked(statsLevene).mockResolvedValue(null as never);
  vi.mocked(statsTukey).mockResolvedValue(null as never);
  vi.mocked(statsRecommend).mockResolvedValue(null as never);
  vi.mocked(reportEmit).mockResolvedValue({ report: { title: "t", sections: [] } } as never);
  useApp.setState({ datasets: [LOADED], activeId: "d1", status: "", reports: [], analysisResults: [], history: [], future: [] });
});

describe("Fit Y by X on the input contract", () => {
  it("exposes the resolved inputs: the analysis view over the picked X and Y", async () => {
    const { result } = renderHook(() => useFitYByX());
    act(() => { result.current.setXCol(1); result.current.setYCol(2); });
    expect(result.current.inputs).toMatchObject({ ok: true, xKey: 1, yKeys: [2], rowCount: 11, totalRows: 12, excludedCount: 1 });
    await waitFor(() => expect(result.current.bivariate).not.toBeNull());
    expect((vi.mocked(statsRegression).mock.calls.at(-1)![0] as { x: number[] }).x).toEqual(KEPT_X);
  });

  it("refuses a lazy Origin preview: nothing is computed on it and the full load is requested", async () => {
    useApp.setState({ datasets: [LAZY] });
    const { result } = renderHook(() => useFitYByX());
    act(() => { result.current.setXCol(1); result.current.setYCol(2); });
    expect(result.current.inputs).toMatchObject({ ok: false, code: "pending" });
    await waitFor(() => expect(vi.mocked(fetchBookData).mock.calls.length).toBeGreaterThan(0));
    expect(statsRegression).not.toHaveBeenCalled();
    expect(result.current.bivariate).toBeNull();
  });

  it("computes once the full book lands, on the full rows with the translated exclusion", async () => {
    useApp.setState({ datasets: [LAZY] });
    vi.mocked(fetchBookData).mockResolvedValueOnce(FULL);
    const { result } = renderHook(() => useFitYByX());
    act(() => { result.current.setXCol(1); result.current.setYCol(2); });
    await waitFor(() => expect(result.current.bivariate).not.toBeNull());
    expect((vi.mocked(statsRegression).mock.calls.at(-1)![0] as { x: number[] }).x).toEqual(KEPT_X);
  });

  it("queued report-after-load: clicking → Report on the preview waits, then emits from the FULL analysis view", async () => {
    useApp.setState({ datasets: [LAZY] });
    let finish!: (data: DataStruct) => void;
    vi.mocked(fetchBookData).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useFitYByX());
    act(() => { result.current.setXCol(1); result.current.setYCol(2); });
    await act(async () => { await result.current.toReport(); });
    expect(result.current.reportBusy).toBe(true);
    expect(reportEmit).not.toHaveBeenCalled();
    await act(async () => { finish(FULL); });
    await waitFor(() => expect(useApp.getState().reports).toHaveLength(1));
    expect(reportEmit).toHaveBeenCalledWith(expect.objectContaining({ title: "y by x — bivariate fit" }));
    // Every regression call (leg or report recompute) saw the excluded-aware full rows, never the preview.
    for (const call of vi.mocked(statsRegression).mock.calls) expect((call[0] as { x: number[] }).x).toEqual(KEPT_X);
    expect(result.current.reportBusy).toBe(false);
  });

  it("By partition: levels are cut from the analysis view (an excluded row is in no level)", async () => {
    const { result } = renderHook(() => useFitYByX());
    act(() => { result.current.setXCol(1); result.current.setYCol(2); });
    act(() => result.current.setByCol(0));
    await waitFor(() => expect(result.current.byResults).toHaveLength(2));
    expect(result.current.byLevels.map((level) => level.data.time.length)).toEqual([5, 6]);
    const level0 = vi.mocked(statsRegression).mock.calls.map((call) => (call[0] as { x: number[] }).x).find((x) => x.length === 5);
    expect(level0).toEqual([1.5, 3, 4.5, 6, 7.5]);
  });

  it("By partition on a lazy preview waits for the full book and then partitions it", async () => {
    useApp.setState({ datasets: [LAZY] });
    vi.mocked(fetchBookData).mockResolvedValueOnce(FULL);
    const { result } = renderHook(() => useFitYByX());
    act(() => { result.current.setXCol(1); result.current.setYCol(2); });
    act(() => result.current.setByCol(0));
    await waitFor(() => expect(result.current.byResults).toHaveLength(2));
    expect(result.current.byLevels.map((level) => level.data.time.length)).toEqual([5, 6]);
  });
});
