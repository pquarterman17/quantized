// Test chooser "Out of date" (lane WB7). A change to the picks still DROPS the
// answer (unchanged); new: an answer whose source rows / data changed after it
// landed is marked out of date with Run / Report withheld, and an answer for
// picks dropped in flight lands nowhere.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { resetBookTransportForTests } from "../../../lib/bookData";
import { restoreResolve } from "../workbench/pendingBook.testkit";
import { useStatsChooser } from "./useStatsChooser";

const { recommendMock, runTestMock, emitMock, fetchBookDataMock } = vi.hoisted(() => ({
  recommendMock: vi.fn(), runTestMock: vi.fn(), emitMock: vi.fn(), fetchBookDataMock: vi.fn(),
}));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsRecommend: recommendMock, statsRunTest: runTestMock, reportEmit: emitMock, fetchBookData: fetchBookDataMock,
}));

const DS: Dataset = {
  id: "d1", name: "growth",
  data: {
    time: [1, 2, 3, 4, 5], values: [[10, 20], [11, 21], [12, 22], [13, 23], [14, 24]],
    labels: ["A", "B"], units: ["", ""], metadata: {},
  },
};
const REC = {
  recommendation: "Welch two-sample t-test", endpoint: "/api/stats/ttest", parametric: true,
  n_groups: 2, paired: false, checks: { alpha: 0.05, shapiro_p: [0.5, 0.6] }, reasons: ["normal"],
};
const RESULT = { t: 1.5, p: 0.2 };
const edit = () => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [0] })) }));

beforeEach(() => {
  vi.clearAllMocks();
  resetBookTransportForTests();
  restoreResolve();
  recommendMock.mockResolvedValue(REC);
  runTestMock.mockResolvedValue(RESULT);
  emitMock.mockResolvedValue({ report: { id: "r" } });
  useApp.setState({ datasets: [DS], activeId: "d1", reports: [], openReportId: null });
});

async function recommended() {
  const hook = renderHook(() => useStatsChooser());
  act(() => hook.result.current.toggleCol(1)); // two groups
  await act(async () => { await hook.result.current.recommend(); });
  return hook;
}

describe("Test chooser out-of-date state", () => {
  it("characterization: a fresh answer is current; Run and Report work", async () => {
    const { result } = await recommended();
    expect(result.current.rec).not.toBeNull();
    expect(result.current.stale).toBe(false);
    await act(async () => { await result.current.runRecommended(); });
    expect(result.current.testResult).not.toBeNull();
    await act(async () => { await result.current.toReport(); });
    expect(emitMock).toHaveBeenCalledTimes(1);
  });

  it("characterization: a changed pick drops the answer, unmarked", async () => {
    const { result } = await recommended();
    act(() => result.current.setPaired(true));
    expect(result.current.rec).toBeNull();
    expect(result.current.stale).toBe(false);
  });

  it("changed source rows mark the answer out of date and withhold Run / Report", async () => {
    const { result } = await recommended();
    await act(async () => { await result.current.runRecommended(); });
    act(edit);
    expect(result.current.rec).not.toBeNull(); // shown, marked
    expect(result.current.stale).toBe(true);
    runTestMock.mockClear();
    await act(async () => { await result.current.runRecommended(); });
    await act(async () => { await result.current.toReport(); });
    expect(runTestMock).not.toHaveBeenCalled(); // fail-before: re-ran the old recommendation on new rows
    expect(emitMock).not.toHaveBeenCalled(); // fail-before: reported the old numbers
  });

  it("asking again after a data change clears the mark", async () => {
    const { result } = await recommended();
    act(edit);
    await act(async () => { await result.current.recommend(); });
    expect(result.current.stale).toBe(false);
  });

  it("forced race: rows changed in flight leave the landed answer out of date", async () => {
    let land!: (r: unknown) => void;
    recommendMock.mockImplementationOnce(() => new Promise((r) => { land = r; }));
    const { result } = renderHook(() => useStatsChooser());
    act(() => result.current.toggleCol(1));
    let pending!: Promise<void>;
    act(() => { pending = result.current.recommend(); });
    await act(async () => {});
    act(edit);
    await act(async () => { land(REC); await pending; });
    expect(result.current.rec).not.toBeNull();
    expect(result.current.stale).toBe(true); // fail-before: current
  });

  it("forced race: a pick changed in flight drops the late answer", async () => {
    let land!: (r: unknown) => void;
    recommendMock.mockImplementationOnce(() => new Promise((r) => { land = r; }));
    const { result } = renderHook(() => useStatsChooser());
    act(() => result.current.toggleCol(1));
    let pending!: Promise<void>;
    act(() => { pending = result.current.recommend(); });
    await act(async () => {});
    act(() => result.current.setPaired(true));
    await act(async () => { land(REC); await pending; });
    expect(result.current.rec).toBeNull(); // fail-before: the answer for the old picks landed
    expect(result.current.busy).toBe(false);
  });

  it("a lazy book is resolved before the recommendation, so the answer is current", async () => {
    // The recommendation queues on the shared resolver's own full load (real book transport).
    fetchBookDataMock.mockResolvedValue(DS.data);
    useApp.setState({ datasets: [{ ...DS, data: { ...DS.data, time: [1], values: [[10, 20]] }, pending: { kind: "upload", bookId: "b1", rows: 5, cols: 2, previewSampled: true } }] });
    const hook = renderHook(() => useStatsChooser());
    act(() => hook.result.current.toggleCol(1));
    await act(async () => { await hook.result.current.recommend(); });
    await vi.waitFor(() => expect(hook.result.current.rec).not.toBeNull());
    expect(recommendMock).toHaveBeenCalledWith({ groups: [[10, 11, 12, 13, 14], [20, 21, 22, 23, 24]], paired: false });
    expect(hook.result.current.stale).toBe(false);
  });
});
