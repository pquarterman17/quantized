// The chooser's queued recommendation (a lazy Origin book) waits on the shared
// resolver's own full load instead of fetching the book a second way.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetBookTransportForTests } from "../../../lib/bookData";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useStatsChooser } from "./useStatsChooser";

const { recommendMock, fetchBookDataMock } = vi.hoisted(() => ({ recommendMock: vi.fn(), fetchBookDataMock: vi.fn() }));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsRecommend: recommendMock, fetchBookData: fetchBookDataMock,
}));

const FULL: Dataset["data"] = {
  time: [1, 2, 3, 4, 5], values: [[10, 20], [11, 21], [12, 22], [13, 23], [14, 24]],
  labels: ["A", "B"], units: ["", ""], metadata: {},
};
const lazy = (): Dataset => ({
  id: "d1", name: "growth", data: { ...FULL, time: [1], values: [[10, 20]] },
  pending: { kind: "upload", bookId: "b1", rows: 5, cols: 2, previewSampled: true },
});
const REC = { recommendation: "Welch", endpoint: "/api/stats/ttest", parametric: true, n_groups: 2, paired: false, checks: {}, reasons: [] };

beforeEach(() => {
  vi.clearAllMocks();
  resetBookTransportForTests();
  recommendMock.mockResolvedValue(REC);
  useApp.setState({ datasets: [lazy()], activeId: "d1" });
});

describe("chooser queue rides the resolver's load", () => {
  it("recommends from the full rows without its own resolveDataset fetch", async () => {
    fetchBookDataMock.mockResolvedValue(FULL);
    const resolveSpy = vi.fn(useApp.getState().resolveDataset);
    useApp.setState({ resolveDataset: resolveSpy });
    const { result } = renderHook(() => useStatsChooser());
    act(() => result.current.toggleCol(1));
    expect(result.current.inputs.ok).toBe(false); // the preview is refused
    await act(async () => { await result.current.recommend(); });
    await vi.waitFor(() => expect(result.current.rec).not.toBeNull());
    expect(recommendMock).toHaveBeenCalledWith({ groups: [[10, 11, 12, 13, 14], [20, 21, 22, 23, 24]], paired: false });
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(fetchBookDataMock).toHaveBeenCalledTimes(1);
  });

  it("drops excluded rows of the full book (analysis-view policy is unchanged)", async () => {
    fetchBookDataMock.mockResolvedValue(FULL);
    const { result } = renderHook(() => useStatsChooser());
    act(() => result.current.toggleCol(1));
    await act(async () => { await result.current.recommend(); });
    await vi.waitFor(() => expect(result.current.rec).not.toBeNull());
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [0] })) })));
    expect(result.current.groups[0].values).toEqual([11, 12, 13, 14]);
  });

  it("fails closed with the load failure reason and never recommends", async () => {
    fetchBookDataMock.mockRejectedValue(new Error("source moved"));
    const { result } = renderHook(() => useStatsChooser());
    act(() => result.current.toggleCol(1));
    await act(async () => { await result.current.recommend(); });
    await vi.waitFor(() => expect(result.current.error).toMatch(/failed to load.*source moved/));
    expect(result.current.busy).toBe(false);
    expect(recommendMock).not.toHaveBeenCalled();
  });

  it("a click after the load already failed says why (not 'no groups') and re-kicks the load", async () => {
    fetchBookDataMock.mockRejectedValueOnce(new Error("source moved"));
    const { result } = renderHook(() => useStatsChooser());
    act(() => result.current.toggleCol(1));
    await vi.waitFor(() => expect(result.current.inputs.ok === false && result.current.inputs.code).toBe("load-failed"));
    fetchBookDataMock.mockClear();
    await act(async () => { await result.current.recommend(); });
    expect(result.current.error).toMatch(/failed to load.*source moved/);
    expect(result.current.error).not.toMatch(/No groups/);
    expect(fetchBookDataMock).toHaveBeenCalledTimes(1);
    expect(recommendMock).not.toHaveBeenCalled();
  });
});
